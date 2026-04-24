jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

import request from "supertest";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { createTestApp, authHeaders, generateDrToken, TEST_USER } from "../setup";

const app = createTestApp();
const token = generateDrToken(TEST_USER.id, TEST_USER.phone);

describe("DeepRead Sync", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── POST /sync/export ──────────────────────────────────

  describe("POST /api/v1/dr/sync/export", () => {
    it("无备份时应返回 data: null", async () => {
      prismaMock.drSyncBackup.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/dr/sync/export")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it("有备份时应返回数据", async () => {
      prismaMock.drSyncBackup.findUnique.mockResolvedValue({
        userId: TEST_USER.id,
        data: '{"bookmarks": []}',
      });

      const res = await request(app)
        .post("/api/v1/dr/sync/export")
        .set(authHeaders(token));

      expect(res.status).toBe(200);
      expect(res.body.data).toBe('{"bookmarks": []}');
    });
  });

  // ── POST /sync/import ──────────────────────────────────

  describe("POST /api/v1/dr/sync/import", () => {
    it("应成功导入数据", async () => {
      prismaMock.drSyncBackup.upsert.mockResolvedValue({});

      const res = await request(app)
        .post("/api/v1/dr/sync/import")
        .set(authHeaders(token))
        .send({ data: '{"bookmarks": [1,2,3]}' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch("导入成功");
      expect(prismaMock.drSyncBackup.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { data: '{"bookmarks": [1,2,3]}' },
        }),
      );
    });

    it("data 为空应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/sync/import")
        .set(authHeaders(token))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("data");
    });

    it("data 为空字符串应成功导入（允许空字符串）", async () => {
      prismaMock.drSyncBackup.upsert.mockResolvedValue({});

      const res = await request(app)
        .post("/api/v1/dr/sync/import")
        .set(authHeaders(token))
        .send({ data: "" });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch("导入成功");
    });
  });
});
