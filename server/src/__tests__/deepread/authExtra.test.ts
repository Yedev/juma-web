jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

import request from "supertest";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { createTestApp, generateSignHeaders, TEST_USER } from "../setup";

const app = createTestApp();
const SIGN = generateSignHeaders;

// Route AppConfig lookups by key so we can drive default-quota / default-space logic.
function configByKey(map: Record<string, string>) {
  prismaMock.appConfig.findUnique.mockImplementation(({ where }: { where: { configKey: string } }) =>
    Promise.resolve(where.configKey in map ? { configValue: map[where.configKey] } : null),
  );
}

describe("DeepRead Auth — service branches", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("新用户登录应创建默认额度并自动加入默认空间", async () => {
    // Use dev bypass code 888888 so no SMS verification path is required.
    prismaMock.drUser.findUnique.mockResolvedValue(null); // phone not found, no device_id
    prismaMock.drUser.create.mockResolvedValue({
      id: 20,
      phone: "13800009999",
      nickname: "用户9999",
      avatar: "",
      platform: "",
    });
    configByKey({
      dr_ai_default_daily_limit: "10",
      dr_default_space_id: JSON.stringify("sp_default"),
    });
    prismaMock.drAiQuota.create.mockResolvedValue({});
    prismaMock.drSpace.findUnique.mockResolvedValue({ spaceId: "sp_default", name: "默认空间" });
    prismaMock.drSpaceMember.create.mockResolvedValue({});

    const res = await request(app)
      .post("/api/v1/dr/login")
      .set(SIGN())
      .send({ phone: "13800009999", code: "888888" });

    expect(res.status).toBe(200);
    expect(prismaMock.drUser.create).toHaveBeenCalled();
    expect(prismaMock.drAiQuota.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 20, dailyLimit: 10 }) }),
    );
    // auto-join default space
    expect(prismaMock.drSpaceMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ spaceId: "sp_default", userId: 20 }) }),
    );
  });

  it("默认空间不存在时应跳过自动加入但仍登录成功", async () => {
    prismaMock.drUser.findUnique.mockResolvedValue(null);
    prismaMock.drUser.create.mockResolvedValue({
      id: 21,
      phone: "13800008888",
      nickname: "用户8888",
      avatar: "",
      platform: "",
    });
    configByKey({ dr_default_space_id: JSON.stringify("sp_missing") });
    prismaMock.drAiQuota.create.mockResolvedValue({});
    prismaMock.drSpace.findUnique.mockResolvedValue(null); // default space missing

    const res = await request(app)
      .post("/api/v1/dr/login")
      .set(SIGN())
      .send({ phone: "13800008888", code: "888888" });

    expect(res.status).toBe(200);
    expect(prismaMock.drSpaceMember.create).not.toHaveBeenCalled();
  });

  it("已存在用户切换平台时应更新 platform", async () => {
    prismaMock.drUser.findUnique.mockResolvedValue({ ...TEST_USER, platform: "" });
    prismaMock.drUser.update.mockResolvedValue({ ...TEST_USER, platform: "ios" });

    const res = await request(app)
      .post("/api/v1/dr/login")
      .set(SIGN())
      .send({ phone: TEST_USER.phone, code: "888888", platform: "ios" });

    expect(res.status).toBe(200);
    expect(prismaMock.drUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TEST_USER.id }, data: { platform: "ios" } }),
    );
  });

  it("手机号未注册但提供 device_id 时应将游客升级为正式用户", async () => {
    // 1st findUnique (by phone) → null; 2nd findUnique (by deviceId) → existing guest
    prismaMock.drUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 7, deviceId: "device_guest1234", role: "guest", platform: "" });
    prismaMock.drUser.update.mockResolvedValue({
      id: 7,
      phone: "13800007777",
      role: "user",
      nickname: "用户7777",
      avatar: "",
      platform: "",
    });
    configByKey({ dr_ai_default_daily_limit: "10" });
    prismaMock.drAiQuota.upsert.mockResolvedValue({});

    const res = await request(app)
      .post("/api/v1/dr/login")
      .set(SIGN())
      .send({ phone: "13800007777", code: "888888", device_id: "device_guest1234" });

    expect(res.status).toBe(200);
    // upgraded via update, not via create
    expect(prismaMock.drUser.create).not.toHaveBeenCalled();
    expect(prismaMock.drUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ phone: "13800007777", role: "user" }),
      }),
    );
    expect(prismaMock.drAiQuota.upsert).toHaveBeenCalled();
  });
});
