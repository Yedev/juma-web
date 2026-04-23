import { PrismaClient } from "@prisma/client";
import cron from "node-cron";
import logger from "../lib/logger";

const prisma = new PrismaClient();
const log = logger.child({ module: "InviteCodeCleaner" });

async function runCleanup() {
  try {
    log.info("cleanup start");

    const expiredCodes = await prisma.drInviteCode.findMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { disabled: true }],
      },
      select: { codeId: true },
    });

    const codeIds = expiredCodes.map((c) => c.codeId);

    if (codeIds.length === 0) {
      log.info("no expired/disabled invite codes");
      return;
    }

    const deleteResult = await prisma.drSpaceMember.deleteMany({
      where: { inviteCodeId: { in: codeIds } },
    });

    log.info({ removed: deleteResult.count, codes: codeIds.length }, "cleanup done");
  } catch (err) {
    log.error({ err }, "cleanup failed");
  }
}

export function startInviteCodeCleanupTask() {
  log.info("scheduled daily invite-code cleanup at 03:00");
  cron.schedule("0 3 * * *", () => {
    void runCleanup();
  });
}
