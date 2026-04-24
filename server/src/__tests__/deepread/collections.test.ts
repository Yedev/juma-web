jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

jest.mock("../../lib/generateId", () => ({
  generateId: (prefix: string) => `${prefix}_mock_${Date.now()}`,
  generateStatsId: () => "RS_mock",
  generateAnalyticsEventId: () => "AE_mock",
}));

import request from "supertest";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { createTestApp, authHeaders, generateDrToken, TEST_USER } from "../setup";

const app = createTestApp();
const token = generateDrToken(TEST_USER.id, TEST_USER.phone);

describe("DeepRead Collections", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── POST /collections ──────────────────────────────────

  describe("POST /api/v1/dr/collections", () => {
    it("应成功创建合集", async () => {
      prismaMock.drCollection.create.mockResolvedValue({
        collectionId: "C123456",
        userId: TEST_USER.id,
        name: "我的收藏",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post("/api/v1/dr/collections")
        .set(authHeaders(token))
        .send({ name: "我的收藏" });

      expect(res.status).toBe(200);
      expect(res.body.data.collectionId).toBe("C123456");
      expect(res.body.data.name).toBe("我的收藏");
    });

    it("名称为空应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/collections")
        .set(authHeaders(token))
        .send({ name: "" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("合集名称不能为空");
    });

    it("名称为纯空白应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/collections")
        .set(authHeaders(token))
        .send({ name: "   " });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("合集名称不能为空");
    });
  });

  // ── PUT /collections/:collectionId/articles ────────────

  describe("PUT /api/v1/dr/collections/:collectionId/articles", () => {
    it("应成功添加文章到合集", async () => {
      prismaMock.drCollection.findUnique.mockResolvedValue({
        collectionId: "C_test",
        userId: TEST_USER.id,
        name: "测试合集",
      });
      prismaMock.drCollectionArticle.upsert.mockResolvedValue({});

      const res = await request(app)
        .put("/api/v1/dr/collections/C_test/articles")
        .set(authHeaders(token))
        .send({ article_id: "art_001", action: "add" });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch("已添加到合集");
      expect(prismaMock.drCollectionArticle.upsert).toHaveBeenCalled();
    });

    it("应成功从合集移除文章", async () => {
      prismaMock.drCollection.findUnique.mockResolvedValue({
        collectionId: "C_test",
        userId: TEST_USER.id,
        name: "测试合集",
      });
      prismaMock.drCollectionArticle.deleteMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .put("/api/v1/dr/collections/C_test/articles")
        .set(authHeaders(token))
        .send({ article_id: "art_001", action: "remove" });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch("已从合集移除");
      expect(prismaMock.drCollectionArticle.deleteMany).toHaveBeenCalled();
    });

    it("合集不存在应返回 404", async () => {
      prismaMock.drCollection.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put("/api/v1/dr/collections/NONEXISTENT/articles")
        .set(authHeaders(token))
        .send({ article_id: "art_001", action: "add" });

      expect(res.status).toBe(404);
    });

    it("操作他人合集应返回 403", async () => {
      prismaMock.drCollection.findUnique.mockResolvedValue({
        collectionId: "C_other",
        userId: 999,
        name: "别人的合集",
      });

      const res = await request(app)
        .put("/api/v1/dr/collections/C_other/articles")
        .set(authHeaders(token))
        .send({ article_id: "art_001", action: "add" });

      expect(res.status).toBe(403);
    });

    it("缺少参数应返回 400", async () => {
      const res = await request(app)
        .put("/api/v1/dr/collections/C_test/articles")
        .set(authHeaders(token))
        .send({ article_id: "art_001" });

      expect(res.status).toBe(400);
    });

    it("缺少 article_id 应返回 400", async () => {
      const res = await request(app)
        .put("/api/v1/dr/collections/C_test/articles")
        .set(authHeaders(token))
        .send({ action: "add" });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /collections ───────────────────────────────────

  describe("GET /api/v1/dr/collections", () => {
    it("应返回合集列表（含文章计数）", async () => {
      prismaMock.drCollection.findMany.mockResolvedValue([
        { collectionId: "C_1", userId: TEST_USER.id, name: "合集1", createdAt: new Date(), updatedAt: new Date() },
      ]);
      prismaMock.drCollectionArticle.groupBy.mockResolvedValue([
        { collectionId: "C_1", _count: { articleId: 3 } },
      ]);

      const res = await request(app)
        .get("/api/v1/dr/collections")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].collectionId).toBe("C_1");
      expect(res.body.data[0].articleCount).toBe(3);
    });

    it("无合集时应返回空列表", async () => {
      prismaMock.drCollection.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/collections")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("合集无文章时 articleCount 应为 0", async () => {
      prismaMock.drCollection.findMany.mockResolvedValue([
        { collectionId: "C_empty", userId: TEST_USER.id, name: "空合集", createdAt: new Date(), updatedAt: new Date() },
      ]);
      prismaMock.drCollectionArticle.groupBy.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/collections")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data[0].articleCount).toBe(0);
    });
  });
});
