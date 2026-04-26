import prisma from "../../lib/prisma";
import getRedis from "../../lib/redis";
import { signDrToken } from "../../middleware/drAuth";
import logger from "../../lib/logger";

const log = logger.child({ module: "drAuthService" });

export async function sendSmsCode(phone: string) {
  // Dev mode: fixed code 888888
  const code = "888888";

  const redis = getRedis();
  if (redis) {
    await redis.set(`sms:code:${phone}`, code, "EX", 300);
  } else {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.drSmsCode.create({ data: { phone, code, expiresAt } });
  }
  return code;
}

export async function loginWithSms(phone: string, code: string, deviceId?: string, platform?: string) {
  const redis = getRedis();
  // for test
  if (code != "888888") {
    if (redis) {
      // Redis path
      const stored = await redis.get(`sms:code:${phone}`);
      if (!stored || stored !== code) return null;
      await redis.del(`sms:code:${phone}`);
    } else {
      // DB fallback
      const smsRecord = await prisma.drSmsCode.findFirst({
        where: { phone, code, used: false, expiresAt: { gte: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      if (!smsRecord) return null;
      await prisma.drSmsCode.update({
        where: { id: smsRecord.id },
        data: { used: true },
      });
    }
  }

  let user = await prisma.drUser.findUnique({ where: { phone } });

  // Guest upgrade: phone not found but deviceId provided → upgrade guest to user
  if (!user && deviceId) {
    const guestUser = await prisma.drUser.findUnique({ where: { deviceId } });
    if (guestUser && guestUser.role === "guest") {
      user = await prisma.drUser.update({
        where: { id: guestUser.id },
        data: { phone, role: "user", nickname: `用户${phone.slice(-4)}` },
      });
      // Update AI quota to normal limit
      const { getConfig } = await import("../../lib/configCache");
      const defaultLimit = Number(await getConfig("dr_ai_default_daily_limit")) || 10;
      await prisma.drAiQuota.upsert({
        where: { userId: user.id },
        update: { dailyLimit: defaultLimit },
        create: { userId: user.id, dailyLimit: defaultLimit },
      });
      log.info({ userId: user.id, phone, deviceId }, "dr.guest.upgraded");
    }
  }

  const isNewUser = !user;
  if (!user) {
    user = await prisma.drUser.create({
      data: { phone, nickname: `用户${phone.slice(-4)}`, platform: platform || "" },
    });
    log.info({ userId: user.id, phone }, "dr.user.registered");

    const { getConfig } = await import("../../lib/configCache");
    const defaultLimit = Number(await getConfig("dr_ai_default_daily_limit")) || 10;
    if (defaultLimit >= 0) {
      await prisma.drAiQuota.create({
        data: { userId: user.id, dailyLimit: defaultLimit },
      });
    }

    await autoJoinDefaultSpace(user.id);
  }

  log.info({ userId: user.id, phone, isNewUser }, "dr.user.login");

  const token = signDrToken({ userId: user.id, phone: user.phone ?? undefined, role: user.role });
  return { token, user };
}

type ServiceError = { error: string; status: number };

export async function loginAsGuest(deviceId: string, platform?: string) {
  let user = await prisma.drUser.findUnique({ where: { deviceId } });
  const isNewUser = !user;

  if (!user) {
    user = await prisma.drUser.create({
      data: { deviceId, role: "guest", phone: null, nickname: "游客", platform: platform || "" },
    });
    log.info({ userId: user.id, deviceId }, "dr.guest.registered");

    const { getConfig } = await import("../../lib/configCache");
    const guestLimit = Number(await getConfig("dr_guest_daily_limit")) || 3;
    await prisma.drAiQuota.create({ data: { userId: user.id, dailyLimit: guestLimit } });

    await autoJoinDefaultSpace(user.id);
  }

  log.info({ userId: user.id, deviceId, isNewUser }, "dr.guest.login");
  const token = signDrToken({ userId: user.id, role: user.role });
  return { token, user };
}

async function autoJoinDefaultSpace(userId: number) {
  try {
    const { getConfig } = await import("../../lib/configCache");
    const rawSpaceId = await getConfig("dr_default_space_id");
    const defaultSpaceId = rawSpaceId ? JSON.parse(rawSpaceId) : null;
    if (!defaultSpaceId) {
      log.warn({ userId }, "dr_default_space_id not configured, skip auto-join");
      return;
    }
    const space = await prisma.drSpace.findUnique({ where: { spaceId: defaultSpaceId } });
    if (!space) {
      log.warn({ userId, defaultSpaceId }, "default space not found, skip auto-join");
      return;
    }
    await prisma.drSpaceMember.create({
      data: { spaceId: defaultSpaceId, userId, role: "member" },
    });
    log.info({ userId, spaceId: defaultSpaceId }, "dr.user.joined-default-space");
  } catch (err) {
    log.error({ err, userId }, "auto-join default space failed");
  }
}

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

export async function getUserProfile(userId: number) {
  const user = await prisma.drUser.findUnique({ where: { id: userId } });
  if (!user) return null;

  const memberships = await prisma.drSpaceMember.findMany({
    where: { userId },
    orderBy: { joinedAt: "asc" },
  });

  const spaceIds = memberships.map((m) => m.spaceId);
  const spaces = await prisma.drSpace.findMany({
    where: { spaceId: { in: spaceIds } },
    select: { spaceId: true, name: true, description: true },
  });

  const spaceMap = new Map(spaces.map((s) => [s.spaceId, s]));

  return {
    id: user.id,
    phone: user.phone,
    role: user.role,
    nickname: user.nickname,
    avatar: user.avatar,
    createdAt: user.createdAt,
    spaces: memberships.map((m) => ({
      spaceId: m.spaceId,
      name: spaceMap.get(m.spaceId)?.name ?? "",
      description: spaceMap.get(m.spaceId)?.description ?? "",
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  };
}

export async function updateUserNickname(userId: number, nickname: string) {
  return prisma.drUser.update({
    where: { id: userId },
    data: { nickname },
    select: { id: true, phone: true, nickname: true, avatar: true },
  });
}

export async function requireMembership(userId: number, spaceId: string): Promise<boolean> {
  const member = await prisma.drSpaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
  });
  return !!member;
}
