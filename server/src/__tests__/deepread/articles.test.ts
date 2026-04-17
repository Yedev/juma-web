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
      prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });

      const res = await request(app)
        .get("/api/v1/dr/articles/art_001")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.articleId).toBe("art_001");
      expect(res.body.data.readCount).toBe(6);
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
});
