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

describe("DeepRead Homepage", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── GET /spaces/:spaceId/homepage ──────────────────────

  describe("GET /api/v1/dr/spaces/:spaceId/homepage", () => {
    it("应返回首页模块列表", async () => {
      prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.drSpaceHomepageModule.findMany.mockResolvedValue([
        {
          moduleId: "mod_001",
          spaceId: "sp_001",
          moduleType: "standard",
          title: "推荐阅读",
          subtitle: "",
          description: "",
          layoutType: "large_horizontal",
          sourceType: "",
          sourceId: "",
          sortOrder: 0,
        },
      ]);
      prismaMock.drSpaceHomepageModuleResource.findMany.mockResolvedValue([
        {
          moduleId: "mod_001",
          resourceType: "article",
          resourceId: "art_001",
          sortOrder: 0,
        },
      ]);
      prismaMock.drArticle.findMany.mockResolvedValue([TEST_ARTICLE]);
      prismaMock.drBookmark.findMany.mockResolvedValue([]);
      prismaMock.drReadStatus.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/spaces/sp_001/homepage")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].moduleId).toBe("mod_001");
      expect(res.body.data[0].title).toBe("推荐阅读");
      expect(res.body.data[0].resources).toBeInstanceOf(Array);
      expect(res.body.data[0].resources[0].resourceType).toBe("article");
    });

    it("非空间成员应返回 403", async () => {
      prismaMock.drSpaceMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/spaces/sp_001/homepage")
        .set(authHeaders(token));

      expect(res.status).toBe(403);
    });
  });

  // ── GET /daily-article ─────────────────────────────────

  describe("GET /api/v1/dr/daily-article", () => {
    it("无空间成员时应返回提示", async () => {
      prismaMock.drSpaceMember.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/daily-article")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.article).toBeNull();
      expect(res.body.data.reason).toMatch("您还没有加入任何空间");
    });

    it("无精选文章时应返回提示", async () => {
      prismaMock.drSpaceMember.findMany.mockResolvedValue([{ spaceId: "sp_001" }]);
      prismaMock.drDailyPickArticle.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/daily-article")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.article).toBeNull();
      expect(res.body.data.reason).toMatch("暂无精选文章");
    });

    it("应返回每日精选文章", async () => {
      prismaMock.drSpaceMember.findMany.mockResolvedValue([{ spaceId: "sp_001" }]);
      prismaMock.drDailyPickArticle.findFirst.mockResolvedValue({
        articleId: "art_001",
        spaceId: "sp_001",
        reason: "今日推荐",
        enabled: true,
      });
      prismaMock.drArticle.findUnique.mockResolvedValue(TEST_ARTICLE);
      prismaMock.drChannel.findUnique.mockResolvedValue({ channelId: "ch_001", name: "测试频道" });
      prismaMock.drEditorHighlight.findMany.mockResolvedValue([]);
      prismaMock.drDailyPickLattice.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/daily-article")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.article).not.toBeNull();
      expect(res.body.data.article.title).toBe("测试文章");
      expect(res.body.data.article.channelName).toBe("测试频道");
      expect(res.body.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
