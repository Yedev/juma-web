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
        data: {
          configKey: cfg.key,
          configValue: JSON.stringify(cfg.value, null, 2),
        },
      });
      console.log(`Seed: created config '${cfg.key}'`);
    } else {
      console.log(`Seed: config '${cfg.key}' already exists, skipping`);
    }
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
