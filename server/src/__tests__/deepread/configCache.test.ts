jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});
jest.mock("../../lib/redis");

import type { Response } from "express";
import getRedis from "../../lib/redis";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { getConfig, invalidateConfig } from "../../lib/configCache";
import { handleError } from "../../lib/errors";

const mockGetRedis = getRedis as jest.MockedFunction<typeof getRedis>;

describe("configCache.getConfig", () => {
  beforeEach(() => {
    resetAllMocks();
    mockGetRedis.mockReset();
  });

  it("Redis 命中时应直接返回缓存值且不查询数据库", async () => {
    const get = jest.fn().mockResolvedValue("cached-value");
    mockGetRedis.mockReturnValue({ get } as never);

    const value = await getConfig("some_key");

    expect(value).toBe("cached-value");
    expect(get).toHaveBeenCalledWith("config:some_key");
    expect(prismaMock.appConfig.findUnique).not.toHaveBeenCalled();
  });

  it("Redis 未命中时应回退数据库并写入缓存", async () => {
    const get = jest.fn().mockResolvedValue(null);
    const set = jest.fn().mockResolvedValue("OK");
    mockGetRedis.mockReturnValue({ get, set } as never);
    prismaMock.appConfig.findUnique.mockResolvedValue({ configValue: "db-value" });

    const value = await getConfig("some_key");

    expect(value).toBe("db-value");
    expect(set).toHaveBeenCalledWith("config:some_key", "db-value", "EX", 60);
  });

  it("无 Redis 时应直接查询数据库", async () => {
    mockGetRedis.mockReturnValue(null as never);
    prismaMock.appConfig.findUnique.mockResolvedValue({ configValue: "db-only" });

    const value = await getConfig("k");

    expect(value).toBe("db-only");
  });

  it("数据库无记录时应返回 null", async () => {
    mockGetRedis.mockReturnValue(null as never);
    prismaMock.appConfig.findUnique.mockResolvedValue(null);

    expect(await getConfig("missing")).toBeNull();
  });

  it("invalidateConfig 应删除缓存键", async () => {
    const del = jest.fn().mockResolvedValue(1);
    mockGetRedis.mockReturnValue({ del } as never);

    await invalidateConfig("some_key");

    expect(del).toHaveBeenCalledWith("config:some_key");
  });

  it("无 Redis 时 invalidateConfig 应静默返回", async () => {
    mockGetRedis.mockReturnValue(null as never);
    await expect(invalidateConfig("k")).resolves.toBeUndefined();
  });
});

describe("errors.handleError", () => {
  function fakeRes() {
    const res = {
      headersSent: false,
      statusCode: undefined as number | undefined,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res as unknown as Response & { statusCode?: number; body?: unknown };
  }

  it("未发送响应头时应返回 500", () => {
    const res = fakeRes();
    handleError(res, "ctx", new Error("boom"));
    expect((res as unknown as { statusCode?: number }).statusCode).toBe(500);
    expect((res as unknown as { body: { code: number } }).body.code).toBe(500);
  });

  it("已发送响应头时应跳过写入", () => {
    const res = fakeRes();
    (res as unknown as { headersSent: boolean }).headersSent = true;
    handleError(res, "ctx", new Error("boom"));
    expect((res as unknown as { statusCode?: number }).statusCode).toBeUndefined();
  });
});
