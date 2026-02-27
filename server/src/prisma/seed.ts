import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.adminUser.findUnique({
    where: { username: "juma" },
  });

  if (!existing) {
    const hashedPassword = await bcrypt.hash("juma2026", 10);
    await prisma.adminUser.create({
      data: {
        username: "juma",
        password: hashedPassword,
      },
    });
    console.log("Seed: created default admin user (juma)");
  } else {
    console.log("Seed: admin user already exists, skipping");
  }

  const configExists = await prisma.appConfig.findUnique({
    where: { configKey: "global_json" },
  });

  if (!configExists) {
    await prisma.appConfig.create({
      data: {
        configKey: "global_json",
        configValue: JSON.stringify(
          { version: "1.0", theme: "dark", features: { notifications: true, analytics: false } },
          null,
          2
        ),
      },
    });
    console.log("Seed: created default app config");
  } else {
    console.log("Seed: app config already exists, skipping");
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
