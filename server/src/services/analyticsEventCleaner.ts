import cron from "node-cron";
import prisma from "../lib/prisma";
import { getConfig } from "../lib/configCache";
import logger from "../lib/logger";

const DEFAULT_RETENTION_DAYS = 90;
const log = logger.child({ module: "AnalyticsCleaner" });

async function runCleanup() {
  try {
    const retentionConfig = await getConfig("analytics_retention_days");
    const retentionDays = retentionConfig ? parseInt(retentionConfig, 10) : DEFAULT_RETENTION_DAYS;

    if (Number.isNaN(retentionDays) || retentionDays <= 0) {
      log.warn({ retentionConfig }, "invalid retention config, skip cleanup");
      return;
    }

    log.info({ retentionDays }, "cleanup start");

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await prisma.analyticsEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    log.info({ deleted: result.count, retentionDays }, "cleanup done");
  } catch (err) {
    log.error({ err }, "cleanup failed");
  }
}

export function startAnalyticsEventCleanupTask() {
  log.info("scheduled daily analytics cleanup at 03:00");
  cron.schedule("0 3 * * *", () => {
    void runCleanup();
  });
}
