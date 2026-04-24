jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

import request from "supertest";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { createTestApp, authHeaders, generateDrToken, TEST_USER } from "../setup";

const app = createTestApp();
const token = generateDrToken(TEST_USER.id, TEST_USER.phone);

describe("DeepRead User Profile", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── GET /me ──────────────────────────────────────────

  describe("GET /api/v1/dr/me", () => {
    it("应返回用户资料和空间列表", async () => {
      prismaMock.drUser.findUnique.mockResolvedValue(TEST_USER);
      prismaMock.drSpaceMember.findMany.mockResolvedValue([
        { spaceId: "sp_001", userId: TEST_USER.id, role: "member", joinedAt: new Date() },
      ]);
      prismaMock.drSpace.findMany.mockResolvedValue([
        { spaceId: "sp_001", name: "测试空间", description: "描述" },
      ]);

      const res = await request(app)
        .get("/api/v1/dr/me")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(TEST_USER.id);
      expect(res.body.data.phone).toBe(TEST_USER.phone);
      expect(res.body.data.spaces).toHaveLength(1);
      expect(res.body.data.spaces[0].spaceId).toBe("sp_001");
      expect(res.body.data.spaces[0].name).toBe("测试空间");
      expect(res.body.data.spaces[0].role).toBe("member");
    });

    it("用户不存在应返回 404", async () => {
      prismaMock.drUser.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/me")
        .set(authHeaders(token));

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch("用户不存在");
    });

    it("无空间时应返回空列表", async () => {
      prismaMock.drUser.findUnique.mockResolvedValue(TEST_USER);
      prismaMock.drSpaceMember.findMany.mockResolvedValue([]);
      prismaMock.drSpace.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/me")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.spaces).toEqual([]);
    });

    it("多空间时应全部返回", async () => {
      prismaMock.drUser.findUnique.mockResolvedValue(TEST_USER);
      prismaMock.drSpaceMember.findMany.mockResolvedValue([
        { spaceId: "sp_001", userId: TEST_USER.id, role: "member", joinedAt: new Date() },
        { spaceId: "sp_002", userId: TEST_USER.id, role: "admin", joinedAt: new Date() },
      ]);
      prismaMock.drSpace.findMany.mockResolvedValue([
        { spaceId: "sp_001", name: "空间1", description: "" },
        { spaceId: "sp_002", name: "空间2", description: "管理员空间" },
      ]);

      const res = await request(app)
        .get("/api/v1/dr/me")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.spaces).toHaveLength(2);
    });
  });

  // ── PUT /me/nickname ─────────────────────────────────

  describe("PUT /api/v1/dr/me/nickname", () => {
    it("应成功修改昵称", async () => {
      prismaMock.drUser.update.mockResolvedValue({
        id: TEST_USER.id,
        phone: TEST_USER.phone,
        nickname: "新昵称",
        avatar: "",
      });

      const res = await request(app)
        .put("/api/v1/dr/me/nickname")
        .set(authHeaders(token))
        .send({ nickname: "新昵称" });

      expect(res.status).toBe(200);
      expect(res.body.data.nickname).toBe("新昵称");
      expect(prismaMock.drUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TEST_USER.id },
          data: { nickname: "新昵称" },
        }),
      );
    });

    it("昵称为空应返回 400", async () => {
      const res = await request(app)
        .put("/api/v1/dr/me/nickname")
        .set(authHeaders(token))
        .send({ nickname: "" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("昵称不能为空");
    });

    it("昵称为纯空白应返回 400", async () => {
      const res = await request(app)
        .put("/api/v1/dr/me/nickname")
        .set(authHeaders(token))
        .send({ nickname: "   " });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("昵称不能为空");
    });

    it("昵称超过20字符应返回 400", async () => {
      const res = await request(app)
        .put("/api/v1/dr/me/nickname")
        .set(authHeaders(token))
        .send({ nickname: "a".repeat(21) });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("20");
    });

    it("昵称恰好20字符应成功", async () => {
      const name20 = "a".repeat(20);
      prismaMock.drUser.update.mockResolvedValue({
        id: TEST_USER.id,
        phone: TEST_USER.phone,
        nickname: name20,
        avatar: "",
      });

      const res = await request(app)
        .put("/api/v1/dr/me/nickname")
        .set(authHeaders(token))
        .send({ nickname: name20 });

      expect(res.status).toBe(200);
    });

    it("昵称前后空白应被 trim", async () => {
      prismaMock.drUser.update.mockResolvedValue({
        id: TEST_USER.id,
        phone: TEST_USER.phone,
        nickname: "昵称",
        avatar: "",
      });

      const res = await request(app)
        .put("/api/v1/dr/me/nickname")
        .set(authHeaders(token))
        .send({ nickname: "  昵称  " });

      expect(res.status).toBe(200);
      expect(prismaMock.drUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { nickname: "昵称" },
        }),
      );
    });

    it("未提供 nickname 字段应返回 400", async () => {
      const res = await request(app)
        .put("/api/v1/dr/me/nickname")
        .set(authHeaders(token))
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
