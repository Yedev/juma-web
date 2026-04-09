import OpenAI from "openai";
import prisma from "../../lib/prisma";

function getTodayDateString(): string {
  const d = new Date(Date.now() + 8 * 3600_000); // UTC+8
  return d.toISOString().slice(0, 10);
}

type ServiceError = { error: string; status: number };

export async function chat(
  userId: number,
  providerModel: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<ServiceError | { data: { reply: string } }> {
  const idx = providerModel.indexOf("-");
  if (idx === -1) return { error: "provider_model 格式错误，应为 providerName-modelName", status: 400 };

  const providerName = providerModel.slice(0, idx);
  const modelName = providerModel.slice(idx + 1);

  const provider = await prisma.drAiProvider.findUnique({ where: { name: providerName } });
  if (!provider || !provider.enabled) return { error: "AI Provider 不存在或未启用", status: 503 };

  const aiModel = await prisma.drAiModel.findFirst({
    where: { providerId: provider.id, model: modelName, enabled: true },
  });
  if (!aiModel) return { error: "AI 模型不存在或未启用", status: 503 };

  const today = getTodayDateString();
  const costPerUse = aiModel.costPerUse;

  // 确定 dailyLimit
  const quota = await prisma.drAiQuota.findUnique({ where: { userId } });
  let dailyLimit: number;
  if (quota) {
    dailyLimit = quota.dailyLimit;
  } else {
    const defaultCfg = await prisma.appConfig.findUnique({ where: { configKey: "dr_ai_default_daily_limit" } });
    dailyLimit = defaultCfg ? Number(defaultCfg.configValue) : 10;
    if (isNaN(dailyLimit) || dailyLimit < 0) dailyLimit = 10;
  }

  // 原子检查+递增消耗值
  const usage = await prisma.drAiUsage.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, consumed: 0 },
    update: {},
  });

  if (usage.consumed + costPerUse > dailyLimit) {
    return { error: "今日 AI 使用额度已达上限", status: 429 };
  }

  await prisma.drAiUsage.update({
    where: { userId_date: { userId, date: today } },
    data: { consumed: { increment: costPerUse } },
  });

  const client = new OpenAI({ baseURL: provider.baseUrl, apiKey: provider.apiKey });
  const completion = await client.chat.completions.create({ model: modelName, messages });
  const reply = completion.choices[0]?.message?.content ?? "";

  return { data: { reply } };
}
