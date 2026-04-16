import OpenAI from "openai";
import { Stream } from "openai/streaming";
import prisma from "../../lib/prisma";
import getRedis from "../../lib/redis";
import { getConfig } from "../../lib/configCache";

function getTodayDateString(): string {
  const d = new Date(Date.now() + 8 * 3600_000); // UTC+8
  return d.toISOString().slice(0, 10);
}

function calcSecondsUntilMidnightCST(): number {
  const now = new Date();
  const cstNow = new Date(now.getTime() + 8 * 3600_000);
  const midnight = new Date(cstNow);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - cstNow.getTime()) / 1000);
}

type ServiceError = { error: string; status: number };
type ChatContext = {
  modelName: string;
  client: OpenAI;
};

async function prepareChatContext(
  userId: number,
  providerModel: string,
): Promise<ServiceError | ChatContext> {
  const idx = providerModel.indexOf("-");
  if (idx === -1) return { error: "provider_model 格式错误，应为 providerName-modelName", status: 400 };

  const providerName = providerModel.slice(0, idx);
  const modelName = providerModel.slice(idx + 1);

  const redis = getRedis();

  // --- Provider/Model lookup (with optional Redis cache) ---
  let provider: { id: number; name: string; baseUrl: string; apiKey: string; enabled: boolean } | null = null;
  let aiModel: { id: number; providerId: number; model: string; enabled: boolean; costPerUse: number } | null = null;

  if (redis) {
    const cachedProvider = await redis.get(`ai:provider:${providerName}`);
    if (cachedProvider) {
      try {
        provider = JSON.parse(cachedProvider);
      } catch { /* fall through to DB */ }
    }
  }

  if (!provider) {
    const dbProvider = await prisma.drAiProvider.findUnique({ where: { name: providerName } });
    if (!dbProvider || !dbProvider.enabled) return { error: "AI Provider 不存在或未启用", status: 503 };
    provider = dbProvider;
    if (redis) {
      await redis.set(`ai:provider:${providerName}`, JSON.stringify(dbProvider), "EX", 300).catch(() => {});
    }
  }

  if (redis) {
    const cachedModel = await redis.get(`ai:model:${provider.id}:${modelName}`);
    if (cachedModel) {
      try {
        aiModel = JSON.parse(cachedModel);
      } catch { /* fall through to DB */ }
    }
  }

  if (!aiModel) {
    const dbModel = await prisma.drAiModel.findFirst({
      where: { providerId: provider.id, model: modelName, enabled: true },
    });
    if (!dbModel) return { error: "AI 模型不存在或未启用", status: 503 };
    aiModel = dbModel;
    if (redis) {
      await redis.set(`ai:model:${provider.id}:${modelName}`, JSON.stringify(dbModel), "EX", 300).catch(() => {});
    }
  }

  const today = getTodayDateString();
  const costPerUse = aiModel.costPerUse;

  // --- Determine daily limit ---
  const quota = await prisma.drAiQuota.findUnique({ where: { userId } });
  let dailyLimit: number;
  if (quota) {
    dailyLimit = quota.dailyLimit;
  } else {
    dailyLimit = Number(await getConfig("dr_ai_default_daily_limit")) || 10;
    if (isNaN(dailyLimit) || dailyLimit < 0) dailyLimit = 10;
  }

  // --- Quota check & consumption ---
  if (redis) {
    // Redis path: atomic INCRBY
    const key = `ai:usage:${userId}:${today}`;
    const consumed = await redis.incrby(key, costPerUse);

    // First write — set expiry to midnight CST
    if (consumed === costPerUse) {
      await redis.expire(key, calcSecondsUntilMidnightCST()).catch(() => {});
    }

    if (consumed > dailyLimit) {
      // Rollback
      await redis.decrby(key, costPerUse);
      return { error: "今日 AI 使用额度已达上限", status: 429 };
    }

    // Async DB write for audit trail (non-blocking)
    prisma.drAiUsage.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, consumed },
      update: { consumed },
    }).catch(() => {});
  } else {
    // DB fallback: original logic
    await prisma.drAiUsage.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, consumed: 0 },
      update: {},
    });

    const updated = await prisma.$executeRaw`
      UPDATE dr_ai_usages
      SET consumed = consumed + ${costPerUse},
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ${userId}
        AND date = ${today}
        AND consumed + ${costPerUse} <= ${dailyLimit}
    `;

    if (updated === 0) {
      return { error: "今日 AI 使用额度已达上限", status: 429 };
    }
  }

  return {
    modelName,
    client: new OpenAI({ baseURL: provider.baseUrl, apiKey: provider.apiKey }),
  };
}

export async function chat(
  userId: number,
  providerModel: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<ServiceError | { data: { reply: string } }> {
  const context = await prepareChatContext(userId, providerModel);
  if ("error" in context) {
    return context;
  }

  const { client, modelName } = context;
  const completion = await client.chat.completions.create({ model: modelName, messages });
  const reply = completion.choices[0]?.message?.content ?? "";

  return { data: { reply } };
}

export async function chatStream(
  userId: number,
  providerModel: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<ServiceError | { stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> }> {
  const context = await prepareChatContext(userId, providerModel);
  if ("error" in context) {
    return context;
  }

  const { client, modelName } = context;
  const stream = await client.chat.completions.create({
    model: modelName,
    messages,
    stream: true,
  });

  return { stream };
}
