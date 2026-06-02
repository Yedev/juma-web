jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

import request from "supertest";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { createTestApp, authHeaders, generateDrToken, TEST_USER, TEST_ARTICLE } from "../setup";

const app = createTestApp();
const token = generateDrToken(TEST_USER.id, TEST_USER.phone);

describe("DeepRead Articles — collection filter", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("按合集筛选应按 sortOrder 返回合集内文章", async () => {
    prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });
    prismaMock.drSpaceCollection.findUnique.mockResolvedValue({
      collectionId: "col_001",
      spaceId: "sp_001",
    });
    prismaMock.drSpaceCollectionArticle.findMany.mockResolvedValue([
      { collectionId: "col_001", articleId: "art_002", sortOrder: 0 },
      { collectionId: "col_001", articleId: "art_001", sortOrder: 1 },
    ]);
    prismaMock.drSpaceCollectionArticle.count.mockResolvedValue(2);
    prismaMock.drArticle.findMany.mockResolvedValue([
      { ...TEST_ARTICLE, articleId: "art_001", title: "文章1", highlights: "[]" },
      { ...TEST_ARTICLE, articleId: "art_002", title: "文章2", highlights: "[]" },
    ]);

    const res = await request(app)
      .get("/api/v1/dr/articles")
      .set(authHeaders(token))
      .query({ space_id: "sp_001", collection_id: "col_001" });

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.list).toHaveLength(2);
    // Order preserved from collection sortOrder (art_002 first)
    expect(res.body.data.list[0].articleId).toBe("art_002");
    expect(res.body.data.list[1].articleId).toBe("art_001");
    expect(res.body.data.list[0].highlights).toEqual([]);
  });

  it("空合集应返回空列表", async () => {
    prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });
    prismaMock.drSpaceCollection.findUnique.mockResolvedValue({
      collectionId: "col_empty",
      spaceId: "sp_001",
    });
    prismaMock.drSpaceCollectionArticle.findMany.mockResolvedValue([]);
    prismaMock.drSpaceCollectionArticle.count.mockResolvedValue(0);

    const res = await request(app)
      .get("/api/v1/dr/articles")
      .set(authHeaders(token))
      .query({ space_id: "sp_001", collection_id: "col_empty" });

    expect(res.status).toBe(200);
    expect(res.body.data.list).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});
