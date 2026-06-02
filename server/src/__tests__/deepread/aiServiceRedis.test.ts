jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});
jest.mock("../../lib/redis");
jest.mock("../../lib/configCache", () => ({
  getConfig: jest.fn().mockResolvedValue("10"),
}));

const mockCreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import getRedis from "../../lib/redis";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { chat } from "../../services/deepread/drAiService";

const mockGetRedis = getRedis as jest.MockedFunction<typeof getRedis>;

const provider = { id: 1, name: "p", baseUrl: "https://x", apiKey: "k", enabled: true };
const aiModel = { id: 2, providerId: 1, model: "m", enabled: true, costPerUse: 1 };
const messages = [{ role: "user" as const, content: "hi" }];

describe("drAiService — Redis quota path", () => {
  beforeEach(() => {
    resetAllMocks();
    mockGetRedis.mockReset();
    mockCreate.mockReset();
  });

  it("缓存未命中时应查库、回填缓存并通过 Redis 计量", async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue("OK"),
      incrby: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      decrby: jest.fn(),
    };
    mockGetRedis.mockReturnValue(redis as never);
    prismaMock.drAiProvider.findUnique.mockResolvedValue(provider);
    prismaMock.drAiModel.findFirst.mockResolvedValue(aiModel);
    prismaMock.drAiQuota.findUnique.mockResolvedValue({ userId: 1, dailyLimit: 100 });
    prismaMock.drAiUsage.upsert.mockResolvedValue({});
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "reply" } }] });

    const result = await chat(1, "p-m", messages);

    expect("data" in result && result.data.reply).toBe("reply");
    // provider + model both written back to cache
    expect(redis.set).toHaveBeenCalledTimes(2);
    // first usage write sets expiry to midnight
    expect(redis.incrby).toHaveBeenCalled();
    expect(redis.expire).toHaveBeenCalled();
    expect(redis.decrby).not.toHaveBeenCalled();
  });

  it("缓存命中时不应查询数据库", async () => {
    const redis = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key.startsWith("ai:provider:")) return Promise.resolve(JSON.stringify(provider));
        if (key.startsWith("ai:model:")) return Promise.resolve(JSON.stringify(aiModel));
        return Promise.resolve(null);
      }),
      set: jest.fn(),
      incrby: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      decrby: jest.fn(),
    };
    mockGetRedis.mockReturnValue(redis as never);
    prismaMock.drAiQuota.findUnique.mockResolvedValue({ userId: 1, dailyLimit: 100 });
    prismaMock.drAiUsage.upsert.mockResolvedValue({});
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "ok" } }] });

    const result = await chat(1, "p-m", messages);

    expect("data" in result).toBe(true);
    expect(prismaMock.drAiProvider.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.drAiModel.findFirst).not.toHaveBeenCalled();
  });

  it("Redis 计量超额时应回滚并返回 429", async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue("OK"),
      incrby: jest.fn().mockResolvedValue(50), // exceeds limit
      expire: jest.fn(),
      decrby: jest.fn().mockResolvedValue(49),
    };
    mockGetRedis.mockReturnValue(redis as never);
    prismaMock.drAiProvider.findUnique.mockResolvedValue(provider);
    prismaMock.drAiModel.findFirst.mockResolvedValue(aiModel);
    prismaMock.drAiQuota.findUnique.mockResolvedValue({ userId: 1, dailyLimit: 10 });

    const result = await chat(1, "p-m", messages);

    expect("error" in result && result.status).toBe(429);
    expect(redis.decrby).toHaveBeenCalledWith("ai:usage:1:" + new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), 1);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
