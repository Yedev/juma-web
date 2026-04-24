jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

import request from "supertest";
import { createTestApp, authHeaders, generateDrToken, TEST_USER } from "../setup";

const app = createTestApp();
const token = generateDrToken(TEST_USER.id, TEST_USER.phone);

describe("Sign Middleware", () => {
  it("缺少 x-timestamp 应返回 403", async () => {
    const res = await request(app)
      .get("/api/v1/dr/me")
      .set("Authorization", `Bearer ${token}`)
      .set("x-sign", "whatever");

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch("x-timestamp");
  });

  it("x-timestamp 非数字应返回 403", async () => {
    const res = await request(app)
      .get("/api/v1/dr/me")
      .set("Authorization", `Bearer ${token}`)
      .set("x-timestamp", "not-a-number")
      .set("x-sign", "whatever");

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch("invalid x-timestamp");
  });

  it("x-timestamp 过期应返回 403", async () => {
    const expiredTimestamp = (Date.now() - 6 * 60 * 1000).toString(); // 6 minutes ago
    const md5 = require("md5");
    const sign = md5("juma2026_secret" + expiredTimestamp);

    const res = await request(app)
      .get("/api/v1/dr/me")
      .set("Authorization", `Bearer ${token}`)
      .set("x-timestamp", expiredTimestamp)
      .set("x-sign", sign);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch("expired");
  });

  it("缺少 x-sign 应返回 401", async () => {
    const timestamp = Date.now().toString();

    const res = await request(app)
      .get("/api/v1/dr/me")
      .set("Authorization", `Bearer ${token}`)
      .set("x-timestamp", timestamp);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch("x-sign");
  });

  it("x-sign 错误应返回 401", async () => {
    const timestamp = Date.now().toString();

    const res = await request(app)
      .get("/api/v1/dr/me")
      .set("Authorization", `Bearer ${token}`)
      .set("x-timestamp", timestamp)
      .set("x-sign", "wrong-signature");

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch("invalid signature");
  });
});

describe("drAuth Middleware", () => {
  it("缺少 Authorization header 应返回 401", async () => {
    const { generateSignHeaders } = require("../setup");
    const sign = generateSignHeaders();

    const res = await request(app)
      .get("/api/v1/dr/me")
      .set(sign);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch("未登录");
  });

  it("Authorization 格式错误应返回 401", async () => {
    const { generateSignHeaders } = require("../setup");
    const sign = generateSignHeaders();

    const res = await request(app)
      .get("/api/v1/dr/me")
      .set(sign)
      .set("Authorization", "Token abc123");

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch("未登录");
  });

  it("无效 JWT token 应返回 401", async () => {
    const res = await request(app)
      .get("/api/v1/dr/me")
      .set({
        ...require("../setup").generateSignHeaders(),
        Authorization: "Bearer invalid.jwt.token",
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch("Token");
  });

  it("过期 JWT token 应返回 401", async () => {
    const jwt = require("jsonwebtoken");
    const expiredToken = jwt.sign(
      { userId: 1, phone: "13800001111" },
      "deepread_jwt_secret_2026",
      { expiresIn: "-1s" },
    );

    const res = await request(app)
      .get("/api/v1/dr/me")
      .set({
        ...require("../setup").generateSignHeaders(),
        Authorization: `Bearer ${expiredToken}`,
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch("Token");
  });
});
