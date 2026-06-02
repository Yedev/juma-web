jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

import request from "supertest";
import jwt from "jsonwebtoken";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { createTestApp, generateSignHeaders, authHeaders } from "../setup";

const app = createTestApp();
const SIGN = generateSignHeaders;

// Guest JWT carries role: "guest" so guestGuard kicks in.
function guestToken(userId: number) {
  return jwt.sign({ userId, role: "guest" }, "deepread_jwt_secret_2026", { expiresIn: "30d" });
}

describe("DeepRead Guest Login", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── POST /guest/login ────────────────────────────────
  describe("POST /api/v1/dr/guest/login", () => {
    it("新设备应创建游客并返回 token", async () => {
      prismaMock.drUser.findUnique.mockResolvedValue(null); // new device
      prismaMock.drUser.create.mockResolvedValue({
        id: 5,
        deviceId: "device_abc12345",
        role: "guest",
        phone: null,
        nickname: "游客",
        avatar: "",
        platform: "",
      });
      prismaMock.drAiQuota.create.mockResolvedValue({});

      const res = await request(app)
        .post("/api/v1/dr/guest/login")
        .set(SIGN())
        .send({ device_id: "device_abc12345" });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch("游客登录成功");
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.role).toBe("guest");
      expect(res.body.data.user.nickname).toBe("游客");
      expect(prismaMock.drUser.create).toHaveBeenCalled();
      // New guest gets an AI quota
      expect(prismaMock.drAiQuota.create).toHaveBeenCalled();
    });

    it("已存在游客且平台变化时应更新平台", async () => {
      prismaMock.drUser.findUnique.mockResolvedValue({
        id: 6,
        deviceId: "device_existing01",
        role: "guest",
        phone: null,
        nickname: "游客",
        avatar: "",
        platform: "android",
      });
      prismaMock.drUser.update.mockResolvedValue({
        id: 6,
        deviceId: "device_existing01",
        role: "guest",
        nickname: "游客",
        avatar: "",
        platform: "ios",
      });

      const res = await request(app)
        .post("/api/v1/dr/guest/login")
        .set(SIGN())
        .send({ device_id: "device_existing01", platform: "ios" });

      expect(res.status).toBe(200);
      expect(prismaMock.drUser.create).not.toHaveBeenCalled();
      expect(prismaMock.drUser.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 6 }, data: { platform: "ios" } }),
      );
    });

    it("device_id 过短应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/guest/login")
        .set(SIGN())
        .send({ device_id: "short" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("device_id");
    });

    it("device_id 缺失应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/guest/login")
        .set(SIGN())
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── guestGuard restrictions ──────────────────────────
  describe("guestGuard 限制", () => {
    it("游客修改昵称应被拒绝 403", async () => {
      const res = await request(app)
        .put("/api/v1/dr/me/nickname")
        .set(authHeaders(guestToken(6)))
        .send({ nickname: "新昵称" });

      expect(res.status).toBe(403);
      expect(res.body.data.reason).toBe("guest_restricted");
    });

    it("游客加入空间应被拒绝 403", async () => {
      const res = await request(app)
        .post("/api/v1/dr/space/join")
        .set(authHeaders(guestToken(6)))
        .send({ invite_code: "ANYCODE" });

      expect(res.status).toBe(403);
      expect(res.body.data.reason).toBe("guest_restricted");
    });

    it("游客导出数据应被拒绝 403", async () => {
      const res = await request(app)
        .post("/api/v1/dr/sync/export")
        .set(authHeaders(guestToken(6)))
        .send({});

      expect(res.status).toBe(403);
    });

    it("游客访问非受限接口（GET /me）应放行", async () => {
      prismaMock.drUser.findUnique.mockResolvedValue({
        id: 6,
        phone: null,
        role: "guest",
        nickname: "游客",
        avatar: "",
        createdAt: new Date(),
      });
      prismaMock.drSpaceMember.findMany.mockResolvedValue([]);
      prismaMock.drSpace.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/me")
        .set(authHeaders(guestToken(6)));

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe("guest");
    });
  });
});
