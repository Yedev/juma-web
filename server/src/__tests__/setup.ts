import express from "express";
import md5 from "md5";
import jwt from "jsonwebtoken";
import deepreadRoutes from "../routes/deepread";

// ── Express test app ─────────────────────────────────────

export function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/dr", deepreadRoutes);
  return app;
}

// ── Sign helpers ─────────────────────────────────────────

const APP_SECRET = "juma2026_secret";
const DR_JWT_SECRET = "deepread_jwt_secret_2026";

export function generateSignHeaders() {
  const timestamp = Date.now().toString();
  const sign = md5(APP_SECRET + timestamp);
  return { "x-timestamp": timestamp, "x-sign": sign };
}

export function generateDrToken(userId: number, phone: string) {
  return jwt.sign({ userId, phone }, DR_JWT_SECRET, { expiresIn: "30d" });
}

export function authHeaders(token: string) {
  return {
    ...generateSignHeaders(),
    Authorization: `Bearer ${token}`,
  };
}

// ── Test fixtures ────────────────────────────────────────

export const TEST_USER = {
  id: 1,
  phone: "13800001111",
  nickname: "用户1111",
  avatar: "",
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const TEST_ARTICLE = {
  id: 1,
  articleId: "art_001",
  spaceId: "sp_001",
  channelId: "ch_001",
  title: "测试文章",
  summary: "摘要",
  content: "<p>测试内容</p>",
  contentType: "html",
  coverUrl: "",
  layoutType: "default",
  author: "作者",
  readCount: 5,
  publishedAt: new Date("2026-01-01"),
  createdAt: new Date(),
  updatedAt: new Date(),
};
