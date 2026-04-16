jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

import request from "supertest";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import {
  createTestApp,
  authHeaders,
  generateDrToken,
  TEST_USER,
  TEST_ARTICLE,
} from "../setup";

const app = createTestApp();
const token = generateDrToken(TEST_USER.id, TEST_USER.phone);

describe("DeepRead Articles", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── GET /articles ──────────────────────────────────────

  describe("GET /api/v1/dr/articles", () => {
    it("应返回文章列表（含分页）", async () => {
      prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });
      const articles = [
        { ...TEST_ARTICLE, articleId: "art_1", title: "文章1" },
        { ...TEST_ARTICLE, articleId: "art_2", title: "文章2" },
      ];
      prismaMock.drArticle.findMany.mockResolvedValue(articles);
      prismaMock.drArticle.count.mockResolvedValue(2);
      prismaMock.drBookmark.findMany.mockResolvedValue([]);
      prismaMock.drReadStatus.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/articles")
        .set(authHeaders(token))
        .query({ space_id: "sp_001", page: 1, page_size: 20 });

      expect(res.status).toBe(200);
      expect(res.body.data.list).toHaveLength(2);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.page).toBe(1);
    });

    it("缺少 space_id 应返回 400", async () => {
      const res = await request(app)
        .get("/api/v1/dr/articles")
        .set(authHeaders(token));

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("space_id");
    });

    it("非空间成员应返回 403", async () => {
      prismaMock.drSpaceMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/articles")
        .set(authHeaders(token))
        .query({ space_id: "sp_001" });

      expect(res.status).toBe(403);
    });

    it("按频道筛选应正确传递参数", async () => {
      prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.drArticle.findMany.mockResolvedValue([]);
      prismaMock.drArticle.count.mockResolvedValue(0);
      prismaMock.drBookmark.findMany.mockResolvedValue([]);
      prismaMock.drReadStatus.findMany.mockResolvedValue([]);

      await request(app)
        .get("/api/v1/dr/articles")
        .set(authHeaders(token))
        .query({ space_id: "sp_001", channel_id: "ch_001" });

      expect(prismaMock.drArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ channelId: "ch_001" }),
        }),
      );
    });

    it("按合集筛选时合集不存在应返回 404", async () => {
      prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.drSpaceCollection.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/articles")
        .set(authHeaders(token))
        .query({ space_id: "sp_001", collection_id: "col_999" });

      expect(res.status).toBe(404);
    });
  });

  // ── GET /articles/:articleId ───────────────────────────

  describe("GET /api/v1/dr/articles/:articleId", () => {
    it("应返回文章详情并增加阅读计数", async () => {
      prismaMock.drArticle.findUnique.mockResolvedValue(TEST_ARTICLE);
      prismaMock.drArticle.update.mockResolvedValue({ ...TEST_ARTICLE, readCount: 6 });
      prismaMock.drBookmark.findUnique.mockResolvedValue(null);
      prismaMock.drReadStatus.findUnique.mockResolvedValue(null);
      prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });

      const res = await request(app)
        .get("/api/v1/dr/articles/art_001")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.articleId).toBe("art_001");
      expect(res.body.data.readCount).toBe(6);
      expect(res.body.data.bookmarked).toBe(false);
      expect(res.body.data.readProgress).toBe(0);
      expect(prismaMock.drArticle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { articleId: "art_001" },
          data: { readCount: { increment: 1 } },
        }),
      );
    });

    it("文章不存在应返回 404", async () => {
      prismaMock.drArticle.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/articles/nonexistent")
        .set(authHeaders(token));

      expect(res.status).toBe(404);
    });

    it("非空间成员应返回 403", async () => {
      prismaMock.drArticle.findUnique.mockResolvedValue(TEST_ARTICLE);
      prismaMock.drArticle.update.mockResolvedValue(TEST_ARTICLE);
      prismaMock.drSpaceMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/articles/art_001")
        .set(authHeaders(token));

      expect(res.status).toBe(403);
    });
  });

  // ── PUT /articles/:articleId/bookmark ──────────────────

  describe("PUT /api/v1/dr/articles/:articleId/bookmark", () => {
    it("应成功收藏文章", async () => {
      prismaMock.drBookmark.upsert.mockResolvedValue({});

      const res = await request(app)
        .put("/api/v1/dr/articles/art_001/bookmark")
        .set(authHeaders(token))
        .send({ bookmarked: true });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch("已收藏");
      expect(prismaMock.drBookmark.upsert).toHaveBeenCalled();
    });

    it("应成功取消收藏", async () => {
      prismaMock.drBookmark.deleteMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .put("/api/v1/dr/articles/art_001/bookmark")
        .set(authHeaders(token))
        .send({ bookmarked: false });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch("已取消收藏");
      expect(prismaMock.drBookmark.deleteMany).toHaveBeenCalled();
    });
  });

  // ── PUT /articles/:articleId/read ──────────────────────

  describe("PUT /api/v1/dr/articles/:articleId/read", () => {
    it("默认应标记 progress=100", async () => {
      prismaMock.drReadStatus.upsert.mockResolvedValue({});

      const res = await request(app)
        .put("/api/v1/dr/articles/art_001/read")
        .set(authHeaders(token))
        .send({});

      expect(res.status).toBe(200);
      expect(prismaMock.drReadStatus.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ progress: 100 }),
        }),
      );
    });

    it("应支持自定义 progress", async () => {
      prismaMock.drReadStatus.upsert.mockResolvedValue({});

      const res = await request(app)
        .put("/api/v1/dr/articles/art_001/read")
        .set(authHeaders(token))
        .send({ progress: 50 });

      expect(res.status).toBe(200);
      expect(prismaMock.drReadStatus.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ progress: 50 }),
        }),
      );
    });
  });
});
