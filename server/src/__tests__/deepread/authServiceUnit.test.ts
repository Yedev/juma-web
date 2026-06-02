jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});
jest.mock("../../lib/redis");
jest.mock("../../lib/configCache", () => ({
  getConfig: jest.fn().mockResolvedValue("10"),
}));

import getRedis from "../../lib/redis";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { sendSmsCode, loginWithSms } from "../../services/deepread/drAuthService";

const mockGetRedis = getRedis as jest.MockedFunction<typeof getRedis>;

const existingUser = {
  id: 1,
  phone: "13800001111",
  role: "user",
  nickname: "用户1111",
  avatar: "",
  platform: "",
};

describe("drAuthService.sendSmsCode — Redis 存储", () => {
  beforeEach(() => {
    resetAllMocks();
    mockGetRedis.mockReset();
  });

  it("有 Redis 时验证码应写入 Redis 而非数据库", async () => {
    const set = jest.fn().mockResolvedValue("OK");
    mockGetRedis.mockReturnValue({ set } as never);

    const result = await sendSmsCode("13800001111");

    expect(result.devCode).toBe("888888");
    expect(set).toHaveBeenCalledWith("sms:code:13800001111", "888888", "EX", 300);
    expect(prismaMock.drSmsCode.create).not.toHaveBeenCalled();
  });
});

describe("drAuthService.loginWithSms — 验证码校验分支", () => {
  beforeEach(() => {
    resetAllMocks();
    mockGetRedis.mockReset();
  });

  it("Redis 验证码匹配应登录成功并删除验证码", async () => {
    const redis = {
      get: jest.fn().mockResolvedValue("123456"),
      del: jest.fn().mockResolvedValue(1),
    };
    mockGetRedis.mockReturnValue(redis as never);
    prismaMock.drUser.findUnique.mockResolvedValue(existingUser);

    const result = await loginWithSms("13800001111", "123456");

    expect(result).not.toBeNull();
    expect(result?.token).toBeDefined();
    expect(redis.del).toHaveBeenCalledWith("sms:code:13800001111");
  });

  it("Redis 验证码不匹配应返回 null", async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), del: jest.fn() };
    mockGetRedis.mockReturnValue(redis as never);

    const result = await loginWithSms("13800001111", "wrongcode");

    expect(result).toBeNull();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("无 Redis 时应校验数据库验证码并标记为已用", async () => {
    mockGetRedis.mockReturnValue(null as never);
    prismaMock.drSmsCode.findFirst.mockResolvedValue({ id: 9, phone: "13800001111", code: "654321" });
    prismaMock.drSmsCode.update.mockResolvedValue({});
    prismaMock.drUser.findUnique.mockResolvedValue(existingUser);

    const result = await loginWithSms("13800001111", "654321");

    expect(result).not.toBeNull();
    expect(prismaMock.drSmsCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9 }, data: { used: true } }),
    );
  });
});
