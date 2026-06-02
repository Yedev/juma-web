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

const mockCreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

const app = createTestApp();
const token = generateDrToken(TEST_USER.id, TEST_USER.phone);

// An async-iterable stream object shaped like the OpenAI SDK Stream.
function fakeStream(chunks: unknown[]) {
  return {
    controller: { abort: jest.fn() },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

function setupContext() {
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
  prismaMock.drAiQuota.findUnique.mockResolvedValue({ userId: TEST_USER.id, dailyLimit: 100 });
  prismaMock.drAiUsage.upsert.mockResolvedValue({});
  prismaMock.$executeRaw.mockResolvedValue(1);
}

describe("DeepRead AI — streaming success path", () => {
  beforeEach(() => {
    resetAllMocks();
    mockCreate.mockReset();
  });

  const validBody = {
    provider_model: "test-provider-gpt-4",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  it("应以 SSE 推送 delta 并以 done 结束", async () => {
    setupContext();
    mockCreate.mockResolvedValue(
      fakeStream([
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " World" } }] },
        { choices: [{ delta: {} }] }, // empty delta is skipped
      ]),
    );

    const res = await request(app)
      .post("/api/v1/dr/ai/chat/stream")
      .set(authHeaders(token))
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch("text/event-stream");
    expect(res.text).toMatch("stream-start");
    expect(res.text).toMatch("Hello");
    expect(res.text).toMatch("World");
    expect(res.text).toMatch('"type":"done"');
    // The empty-delta chunk must not produce a delta event
    expect(res.text).not.toMatch('"content":""');
  });

  it("流为空时仅发送 start 与 done", async () => {
    setupContext();
    mockCreate.mockResolvedValue(fakeStream([]));

    const res = await request(app)
      .post("/api/v1/dr/ai/chat/stream")
      .set(authHeaders(token))
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.text).toMatch("stream-start");
    expect(res.text).toMatch('"type":"done"');
  });
});
