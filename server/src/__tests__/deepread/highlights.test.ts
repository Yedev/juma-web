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

describe("DeepRead Highlights", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── POST /highlights ───────────────────────────────────

  describe("POST /api/v1/dr/highlights", () => {
    it("应成功创建批注（含 position_data、color、note）", async () => {
      const mockHighlight = {
        highlightId: "H123456",
        articleId: "art_001",
        userId: TEST_USER.id,
        text: "这是一段高亮文本",
        color: "#FF0000",
        positionData: JSON.stringify({ start: 10, end: 20 }),
        note: "这是我的笔记",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prismaMock.drHighlight.create.mockResolvedValue(mockHighlight);

      const res = await request(app)
        .post("/api/v1/dr/highlights")
        .set(authHeaders(token))
        .send({
          article_id: "art_001",
          text: "这是一段高亮文本",
          color: "#FF0000",
          position_data: { start: 10, end: 20 },
          note: "这是我的笔记",
        });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(200);
      expect(res.body.data.text).toBe("这是一段高亮文本");
      expect(res.body.data.color).toBe("#FF0000");
      expect(res.body.data.positionData).toEqual({ start: 10, end: 20 });
      expect(res.body.data.note).toBe("这是我的笔记");
      expect(res.body.data.highlightId).toBeDefined();
    });

    it("缺少 article_id 应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/highlights")
        .set(authHeaders(token))
        .send({ text: "some text" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("article_id");
    });

    it("缺少 text 应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/highlights")
        .set(authHeaders(token))
        .send({ article_id: "art_001" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("text");
    });

    it("仅传必填字段时应使用默认值", async () => {
      const mockHighlight = {
        highlightId: "H_default",
        articleId: "art_001",
        userId: TEST_USER.id,
        text: "只有文本",
        color: "#FFEB3B",
        positionData: "{}",
        note: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prismaMock.drHighlight.create.mockResolvedValue(mockHighlight);

      const res = await request(app)
        .post("/api/v1/dr/highlights")
        .set(authHeaders(token))
        .send({ article_id: "art_001", text: "只有文本" });

      expect(res.status).toBe(200);
      expect(res.body.data.color).toBe("#FFEB3B");
      expect(res.body.data.note).toBe("");
      expect(prismaMock.drHighlight.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            color: "#FFEB3B",
            positionData: "{}",
            note: "",
          }),
        }),
      );
    });
  });

  // ── GET /highlights ────────────────────────────────────

  describe("GET /api/v1/dr/highlights", () => {
    it("应返回文章的批注列表", async () => {
      prismaMock.drHighlight.findMany.mockResolvedValue([
        {
          highlightId: "H1",
          articleId: "art_001",
          userId: TEST_USER.id,
          text: "高亮1",
          color: "#FFEB3B",
          positionData: "{}",
          note: "",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          highlightId: "H2",
          articleId: "art_001",
          userId: TEST_USER.id,
          text: "高亮2",
          color: "#FF0000",
          positionData: JSON.stringify({ page: 1 }),
          note: "笔记",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get("/api/v1/dr/highlights")
        .set(authHeaders(token))
        .query({ article_id: "art_001" });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].text).toBe("高亮1");
      expect(res.body.data[1].note).toBe("笔记");
    });

    it("缺少 article_id 应返回 400", async () => {
      const res = await request(app)
        .get("/api/v1/dr/highlights")
        .set(authHeaders(token));

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("article_id");
    });

    it("文章无批注时应返回空列表", async () => {
      prismaMock.drHighlight.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/dr/highlights")
        .set(authHeaders(token))
        .query({ article_id: "art_001" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
