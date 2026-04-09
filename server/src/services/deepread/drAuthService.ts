import prisma from "../../lib/prisma";
import { signDrToken } from "../../middleware/drAuth";

export async function sendSmsCode(phone: string) {
  // Dev mode: fixed code 888888
  const code = "888888";
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.drSmsCode.create({ data: { phone, code, expiresAt } });
  return code;
}

export async function loginWithSms(phone: string, code: string) {
  const smsRecord = await prisma.drSmsCode.findFirst({
    where: { phone, code, used: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!smsRecord) return null;

  await prisma.drSmsCode.update({
    where: { id: smsRecord.id },
    data: { used: true },
  });

  let user = await prisma.drUser.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.drUser.create({
      data: { phone, nickname: `用户${phone.slice(-4)}` },
    });

    // 为新用户插入默认 AI 配额
    const defaultCfg = await prisma.appConfig.findUnique({ where: { configKey: "dr_ai_default_daily_limit" } });
    const defaultLimit = defaultCfg ? Number(defaultCfg.configValue) : 10;
    if (defaultLimit >= 0) {
      await prisma.drAiQuota.create({
        data: { userId: user.id, dailyLimit: defaultLimit },
      });
    }
  }

  const token = signDrToken({ userId: user.id, phone: user.phone });
  return { token, user };
}

type ServiceError = { error: string; status: number };

export async function joinSpace(userId: number, inviteCodeStr: string): Promise<ServiceError | { data: { spaceId: string; name: string; description: string }; alreadyMember: boolean }> {
  const inviteCode = await prisma.drInviteCode.findUnique({
    where: { code: inviteCodeStr },
  });

  if (!inviteCode || inviteCode.disabled) return { error: "邀请码无效", status: 404 };
  if (inviteCode.expiresAt && inviteCode.expiresAt < new Date()) return { error: "邀请码已过期", status: 400 };
  if (inviteCode.maxUses !== null && inviteCode.useCount >= inviteCode.maxUses) return { error: "邀请码使用次数已达上限", status: 400 };

  const space = await prisma.drSpace.findUnique({ where: { spaceId: inviteCode.spaceId } });
  if (!space) return { error: "空间不存在", status: 404 };

  const existing = await prisma.drSpaceMember.findUnique({
    where: { spaceId_userId: { spaceId: space.spaceId, userId } },
  });

  if (!existing) {
    await prisma.$transaction([
      prisma.drSpaceMember.create({
        data: { spaceId: space.spaceId, userId, role: "member", inviteCodeId: inviteCode.codeId },
      }),
      prisma.drInviteCode.update({
        where: { codeId: inviteCode.codeId },
        data: { useCount: { increment: 1 } },
      }),
    ]);
  }

  return {
    data: { spaceId: space.spaceId, name: space.name, description: space.description },
    alreadyMember: !!existing,
  };
}

export async function requireMembership(userId: number, spaceId: string): Promise<boolean> {
  const member = await prisma.drSpaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
  });
  return !!member;
}
