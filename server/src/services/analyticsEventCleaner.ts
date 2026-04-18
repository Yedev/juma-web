import cron from "node-cron";
import prisma from "../lib/prisma";
import { getConfig } from "../lib/configCache";

const DEFAULT_RETENTION_DAYS = 90;

async function runCleanup() {
  try {
    const retentionConfig = await getConfig("analytics_retention_days");
    const retentionDays = retentionConfig ? parseInt(retentionConfig, 10) : DEFAULT_RETENTION_DAYS;

    if (Number.isNaN(retentionDays) || retentionDays <= 0) {
      console.log("[AnalyticsCleaner] 保留天数配置无效，跳过清理。");
      return;
    }

    console.log(`[AnalyticsCleaner] 开始清理 ${retentionDays} 天前的埋点数据...`);

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await prisma.analyticsEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    if (result.count > 0) {
      console.log(`[AnalyticsCleaner] 清理完成，已删除 ${result.count} 条过期埋点数据。`);
    } else {
      console.log("[AnalyticsCleaner] 没有需要清理的过期埋点数据。");
    }
  } catch (error) {
    console.error("[AnalyticsCleaner] 清理任务执行失败:", error);
  }
}

export function startAnalyticsEventCleanupTask() {
  console.log("[AnalyticsCleaner] 每天凌晨 3:00 清理过期埋点数据的定时任务已挂载。");
  cron.schedule("0 3 * * *", () => {
    void runCleanup();
  });
}
