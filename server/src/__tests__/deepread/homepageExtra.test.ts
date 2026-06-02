jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

import request from "supertest";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { createTestApp, authHeaders, generateDrToken, TEST_USER, TEST_ARTICLE } from "../setup";

const app = createTestApp();
const token = generateDrToken(TEST_USER.id, TEST_USER.phone);

describe("DeepRead Homepage — extra coverage", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── homepage modules with channel & collection resources ──
  describe("GET /spaces/:spaceId/homepage — 多资源类型", () => {
    it("应解析 channel 与 collection 资源详情", async () => {
      prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.drSpaceHomepageModule.findMany.mockResolvedValue([
        {
          moduleId: "mod_mix",
          spaceId: "sp_001",
          moduleType: "standard",
          title: "混合模块",
          subtitle: "",
          description: "",
          layoutType: "grid",
          sourceType: "",
          sourceId: "",
          sortOrder: 0,
        },
      ]);
      prismaMock.drSpaceHomepageModuleResource.findMany.mockResolvedValue([
        { moduleId: "mod_mix", resourceType: "channel", resourceId: "ch_001", sortOrder: 0 },
        { moduleId: "mod_mix", resourceType: "collection", resourceId: "col_001", sortOrder: 1 },
        { moduleId: "mod_mix", resourceType: "article", resourceId: "art_001", sortOrder: 2 },
        // a resource whose detail cannot be resolved -> detail null
        { moduleId: "mod_mix", resourceType: "channel", resourceId: "ch_missing", sortOrder: 3 },
      ]);
      prismaMock.drChannel.findMany.mockResolvedValue([{ channelId: "ch_001", name: "频道一" }]);
      prismaMock.drSpaceCollection.findMany.mockResolvedValue([
        { collectionId: "col_001", name: "合集一" },
      ]);
      prismaMock.drArticle.findMany.mockResolvedValue([TEST_ARTICLE]);

      const res = await request(app)
        .get("/api/v1/dr/spaces/sp_001/homepage")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      const resources = res.body.data[0].resources;
      expect(resources).toHaveLength(4);
      const channelRes = resources.find((r: { resourceId: string }) => r.resourceId === "ch_001");
      expect(channelRes.detail.name).toBe("频道一");
      const collectionRes = resources.find((r: { resourceId: string }) => r.resourceId === "col_001");
      expect(collectionRes.detail.name).toBe("合集一");
      const missing = resources.find((r: { resourceId: string }) => r.resourceId === "ch_missing");
      expect(missing.detail).toBeNull();
    });
  });

  // ── thinking-lattice/history ──────────────────────────
  describe("GET /thinking-lattice/history", () => {
    it("非成员（无空间）时应返回 reason 与空列表", async () => {
      prismaMock.drSpaceMember.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/thinking-lattice/history")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.list).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.reason).toMatch("您还没有加入任何空间");
    });

    it("应分页返回历史格栅（含合集与文章节点）", async () => {
      prismaMock.drSpaceMember.findMany.mockResolvedValue([{ spaceId: "sp_001" }]);
      prismaMock.appConfig.findUnique.mockResolvedValue(null);
      prismaMock.drDailyPickLattice.count.mockResolvedValue(1);
      prismaMock.drDailyPickLattice.findMany.mockResolvedValue([
        {
          latticeId: "lt_h1",
          spaceId: "sp_001",
          collectionId: "col_001",
          weeklyTopic: "历史议题",
          recommendation: "推荐语",
          nodeNames: JSON.stringify(["甲", "乙"]),
          enabled: true,
          createdAt: new Date(),
        },
      ]);
      prismaMock.drSpaceCollection.findUnique.mockResolvedValue({
        collectionId: "col_001",
        name: "历史合集",
        description: "描述",
        coverUrl: "",
      });
      prismaMock.drSpaceCollectionArticle.findMany.mockResolvedValue([
        { collectionId: "col_001", articleId: "art_001", sortOrder: 0 },
        { collectionId: "col_001", articleId: "art_002", sortOrder: 1 },
      ]);
      prismaMock.drArticle.findMany.mockResolvedValue([
        { articleId: "art_001", title: "文一", summary: "摘要一", coverUrl: "", author: "作者" },
        { articleId: "art_002", title: "文二", summary: "摘要二", coverUrl: "", author: "作者" },
      ]);

      const res = await request(app)
        .get("/api/v1/dr/thinking-lattice/history")
        .set(authHeaders(token))
        .query({ page: 1, pageSize: 10 });

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.list).toHaveLength(1);
      const item = res.body.data.list[0];
      expect(item.collection.name).toBe("历史合集");
      expect(item.articles).toHaveLength(2);
      expect(item.articles[0].nodeName).toBe("甲");
      expect(item.articles[1].nodeName).toBe("乙");
    });

    it("历史格栅关联合集缺失时 collection 应为 null", async () => {
      prismaMock.drSpaceMember.findMany.mockResolvedValue([{ spaceId: "sp_001" }]);
      prismaMock.appConfig.findUnique.mockResolvedValue(null);
      prismaMock.drDailyPickLattice.count.mockResolvedValue(1);
      prismaMock.drDailyPickLattice.findMany.mockResolvedValue([
        {
          latticeId: "lt_h2",
          spaceId: "sp_001",
          collectionId: "col_missing",
          weeklyTopic: "",
          recommendation: "",
          nodeNames: "[]",
          enabled: true,
          createdAt: new Date(),
        },
      ]);
      prismaMock.drSpaceCollection.findUnique.mockResolvedValue(null);
      prismaMock.drSpaceCollectionArticle.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/thinking-lattice/history")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data.list[0].collection).toBeNull();
    });
  });

  // ── resolvePreferredSpaceId branches via daily-article ──
  describe("daily-article — requestedSpaceId 分支", () => {
    it("请求非加入空间应返回提示", async () => {
      prismaMock.drSpaceMember.findMany.mockResolvedValue([{ spaceId: "sp_001" }]);

      const res = await request(app)
        .get("/api/v1/dr/daily-article")
        .set(authHeaders(token))
        .query({ spaceId: "sp_other" });

      expect(res.status).toBe(200);
      expect(res.body.data.article).toBeNull();
      expect(res.body.data.reason).toMatch("您不是该空间的成员");
    });

    it("请求已加入空间时应使用该空间", async () => {
      prismaMock.drSpaceMember.findMany.mockResolvedValue([
        { spaceId: "sp_001" },
        { spaceId: "sp_002" },
      ]);
      prismaMock.drDailyPickArticle.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/daily-article")
        .set(authHeaders(token))
        .query({ spaceId: "sp_002" });

      expect(res.status).toBe(200);
      expect(prismaMock.drDailyPickArticle.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ spaceId: "sp_002" }) }),
      );
    });

    it("未指定空间但配置了默认空间且已加入时应优先默认空间", async () => {
      prismaMock.drSpaceMember.findMany.mockResolvedValue([
        { spaceId: "sp_001" },
        { spaceId: "sp_default" },
      ]);
      prismaMock.appConfig.findUnique.mockResolvedValue({
        configValue: JSON.stringify("sp_default"),
      });
      prismaMock.drDailyPickArticle.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/dr/daily-article")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(prismaMock.drDailyPickArticle.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ spaceId: "sp_default" }) }),
      );
    });
  });
});
