jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

jest.mock("../../lib/configCache", () => ({
  getConfig: jest.fn().mockResolvedValue(null),
}));

import request from "supertest";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import { createTestApp, authHeaders, generateDrToken, TEST_USER } from "../setup";

const app = createTestApp();
const token = generateDrToken(TEST_USER.id, TEST_USER.phone);

// Mock OpenAI constructor and chat completions
const mockCreate = jest.fn();
jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

describe("DeepRead AI", () => {
  beforeEach(() => {
    resetAllMocks();
    mockCreate.mockReset();
  });

  // Helper to set up provider + model + quota mocks for a successful context
  function setupChatContextMocks(overrides?: { dailyLimit?: number; costPerUse?: number }) {
    const provider = {
      id: 1,
      name: "test-provider",
      baseUrl: "https://api.example.com",
      apiKey: "sk-test",
      enabled: true,
    };
    const aiModel = {
      id: 1,
      providerId: 1,
      model: "gpt-4",
      enabled: true,
      costPerUse: overrides?.costPerUse ?? 1,
    };
    prismaMock.drAiProvider.findUnique.mockResolvedValue(provider);
    prismaMock.drAiModel.findFirst.mockResolvedValue(aiModel);
    prismaMock.drAiQuota.findUnique.mockResolvedValue({
      userId: TEST_USER.id,
      dailyLimit: overrides?.dailyLimit ?? 100,
    });
    prismaMock.drAiUsage.upsert.mockResolvedValue({});
    prismaMock.$executeRaw.mockResolvedValue(1);
  }

  // ── POST /ai/chat ────────────────────────────────────

  describe("POST /api/v1/dr/ai/chat", () => {
    const validBody = {
      provider_model: "test-provider-gpt-4",
      messages: [{ role: "user" as const, content: "Hello" }],
    };

    it("provider_model 为空应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send({ ...validBody, provider_model: "" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("provider_model");
    });

    it("provider_model 为纯空白应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send({ ...validBody, provider_model: "   " });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("provider_model");
    });

    it("messages 为空数组应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send({ ...validBody, messages: [] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("messages");
    });

    it("messages 不是数组应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send({ ...validBody, messages: "hello" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("messages");
    });

    it("provider_model 格式错误（缺少连字符）应返回 400", async () => {
      setupChatContextMocks();

      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send({ ...validBody, provider_model: "noformat" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("格式错误");
    });

    it("Provider 不存在应返回 503", async () => {
      prismaMock.drAiProvider.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send(validBody);

      expect(res.status).toBe(503);
      expect(res.body.message).toMatch("Provider");
    });

    it("Provider 已禁用应返回 503", async () => {
      prismaMock.drAiProvider.findUnique.mockResolvedValue({
        id: 1,
        name: "test-provider",
        baseUrl: "https://api.example.com",
        apiKey: "sk-test",
        enabled: false,
      });

      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send(validBody);

      expect(res.status).toBe(503);
    });

    it("Model 不存在应返回 503", async () => {
      prismaMock.drAiProvider.findUnique.mockResolvedValue({
        id: 1,
        name: "test-provider",
        baseUrl: "https://api.example.com",
        apiKey: "sk-test",
        enabled: true,
      });
      prismaMock.drAiModel.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send(validBody);

      expect(res.status).toBe(503);
      expect(res.body.message).toMatch("模型");
    });

    it("额度已达上限应返回 429", async () => {
      prismaMock.drAiProvider.findUnique.mockResolvedValue({
        id: 1,
        name: "test-provider",
        baseUrl: "https://api.example.com",
        apiKey: "sk-test",
        enabled: true,
      });
      prismaMock.drAiModel.findFirst.mockResolvedValue({
        id: 1,
        providerId: 1,
        model: "gpt-4",
        enabled: true,
        costPerUse: 1,
      });
      prismaMock.drAiQuota.findUnique.mockResolvedValue({
        userId: TEST_USER.id,
        dailyLimit: 0,
      });
      // DB fallback: $executeRaw returns 0 meaning quota exceeded
      prismaMock.drAiUsage.upsert.mockResolvedValue({});
      prismaMock.$executeRaw.mockResolvedValue(0);

      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send(validBody);

      expect(res.status).toBe(429);
      expect(res.body.message).toMatch("额度");
    });

    it("应成功返回 AI 回复", async () => {
      setupChatContextMocks();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "这是AI的回复" } }],
      });

      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.data.reply).toBe("这是AI的回复");
    });

    it("AI 返回空 content 应返回空字符串", async () => {
      setupChatContextMocks();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.data.reply).toBe("");
    });

    it("无自定义 quota 时应使用默认限额", async () => {
      const { getConfig } = require("../../lib/configCache");
      getConfig.mockResolvedValue("10");

      prismaMock.drAiProvider.findUnique.mockResolvedValue({
        id: 1,
        name: "test-provider",
        baseUrl: "https://api.example.com",
        apiKey: "sk-test",
        enabled: true,
      });
      prismaMock.drAiModel.findFirst.mockResolvedValue({
        id: 1,
        providerId: 1,
        model: "gpt-4",
        enabled: true,
        costPerUse: 1,
      });
      prismaMock.drAiQuota.findUnique.mockResolvedValue(null);
      prismaMock.drAiUsage.upsert.mockResolvedValue({});
      prismaMock.$executeRaw.mockResolvedValue(1);
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "ok" } }],
      });

      const res = await request(app)
        .post("/api/v1/dr/ai/chat")
        .set(authHeaders(token))
        .send(validBody);

      expect(res.status).toBe(200);
    });
  });

  // ── POST /ai/chat/stream ─────────────────────────────

  describe("POST /api/v1/dr/ai/chat/stream", () => {
    const validBody = {
      provider_model: "test-provider-gpt-4",
      messages: [{ role: "user" as const, content: "Hello" }],
    };

    it("provider_model 为空应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/ai/chat/stream")
        .set(authHeaders(token))
        .send({ ...validBody, provider_model: "" });

      expect(res.status).toBe(400);
    });

    it("messages 为空应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/ai/chat/stream")
        .set(authHeaders(token))
        .send({ ...validBody, messages: [] });

      expect(res.status).toBe(400);
    });

    it("Provider 不存在应返回 503", async () => {
      prismaMock.drAiProvider.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/dr/ai/chat/stream")
        .set(authHeaders(token))
        .send(validBody);

      expect(res.status).toBe(503);
    });

    it("额度已达上限应返回 429", async () => {
      prismaMock.drAiProvider.findUnique.mockResolvedValue({
        id: 1,
        name: "test-provider",
        baseUrl: "https://api.example.com",
        apiKey: "sk-test",
        enabled: true,
      });
      prismaMock.drAiModel.findFirst.mockResolvedValue({
        id: 1,
        providerId: 1,
        model: "gpt-4",
        enabled: true,
        costPerUse: 1,
      });
      prismaMock.drAiQuota.findUnique.mockResolvedValue({
        userId: TEST_USER.id,
        dailyLimit: 0,
      });
      prismaMock.drAiUsage.upsert.mockResolvedValue({});
      prismaMock.$executeRaw.mockResolvedValue(0);

      const res = await request(app)
        .post("/api/v1/dr/ai/chat/stream")
        .set(authHeaders(token))
        .send(validBody);

      expect(res.status).toBe(429);
    });
  });
});
