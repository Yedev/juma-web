import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const defaultConfigs: { key: string; value: object }[] = [
  {
    key: "global_json",
    value: { version: "1.0", theme: "dark", features: { notifications: true, analytics: false } },
  },
  {
    key: "app_settings",
    value: { language: "zh-CN", timezone: "Asia/Shanghai", maxRetries: 3, timeout: 30000 },
  },
  {
    key: "ad_config",
    value: { enabled: true, provider: "admob", interstitialId: "ca-app-pub-xxx", bannerId: "ca-app-pub-yyy", frequency: 5 },
  },
];

const sampleTasks: { name: string; params: object; status: string; statusInfo: object }[] = [
  {
    name: "数据导出任务",
    params: { format: "csv", target: "orders" },
    status: "completed",
    statusInfo: { output_url: "https://cdn.example.com/exports/orders_20260227.csv", file_size: "2.4MB", rows: 15820 },
  },
  {
    name: "用户画像分析",
    params: { segment: "vip_users" },
    status: "running",
    statusInfo: { current_step: "3/5 聚合用户行为数据", progress: 60 },
  },
  {
    name: "推送通知批量发送",
    params: { channel: "push", audience: "all" },
    status: "error",
    statusInfo: { error: "APNS 证书已过期，请更新推送证书后重试", error_code: "CERT_EXPIRED", failed_at_step: "2/4 连接 APNS 服务" },
  },
  {
    name: "日志清理",
    params: { retain_days: 30 },
    status: "queued",
    statusInfo: { queue_position: 3 },
  },
  {
    name: "报表生成",
    params: { type: "monthly", month: "2026-02" },
    status: "queued",
    statusInfo: { queue_position: 4 },
  },
  {
    name: "图片压缩批处理",
    params: { quality: 80, format: "webp" },
    status: "completed",
    statusInfo: { output_url: "https://cdn.example.com/compressed/batch_001.zip", file_size: "128MB", count: 342 },
  },
  {
    name: "数据库备份",
    params: { target: "production" },
    status: "running",
    statusInfo: { current_step: "1/3 导出数据表", progress: 25 },
  },
  {
    name: "缓存预热",
    params: { scope: "hot_products" },
    status: "error",
    statusInfo: { error: "Redis 连接超时，目标节点 redis-cluster-03 无响应", error_code: "CONN_TIMEOUT", failed_at_step: "1/2 连接 Redis 集群" },
  },
];

async function main() {
  const existing = await prisma.adminUser.findUnique({
    where: { username: "juma" },
  });

  if (!existing) {
    const hashedPassword = await bcrypt.hash("juma2026", 10);
    await prisma.adminUser.create({
      data: { username: "juma", password: hashedPassword },
    });
    console.log("Seed: created default admin user (juma)");
  } else {
    console.log("Seed: admin user already exists, skipping");
  }

  for (const cfg of defaultConfigs) {
    const exists = await prisma.appConfig.findUnique({
      where: { configKey: cfg.key },
    });
    if (!exists) {
      await prisma.appConfig.create({
        data: { configKey: cfg.key, configValue: JSON.stringify(cfg.value, null, 2) },
      });
      console.log(`Seed: created config '${cfg.key}'`);
    } else {
      console.log(`Seed: config '${cfg.key}' already exists, skipping`);
    }
  }

  const taskCount = await prisma.task.count();
  if (taskCount === 0) {
    for (let i = 0; i < sampleTasks.length; i++) {
      const t = sampleTasks[i];
      const taskId = `T${Date.now() - (sampleTasks.length - i) * 60000}${String(i).padStart(3, "0")}`;
      await prisma.task.create({
        data: {
          taskId,
          taskName: t.name,
          taskParams: JSON.stringify(t.params),
          status: t.status,
          statusInfo: JSON.stringify(t.statusInfo),
        },
      });
    }
    console.log(`Seed: created ${sampleTasks.length} sample tasks`);
  } else {
    console.log("Seed: tasks already exist, skipping");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
