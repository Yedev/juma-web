import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const DR_AI_DEFAULT_DAILY_LIMIT = 10;
const DEFAULT_SPACE_NAME = "默认空间";
const DEFAULT_SPACE_DESCRIPTION = "系统默认空间，新注册用户会自动加入";
const DEFAULT_SPACE_ID = "S_DEFAULT";
const DEFAULT_SPACE_INVITE_CODE = "DRDFLT";

async function ensureConfig(configKey: string, configValue: string) {
  const existing = await prisma.appConfig.findUnique({ where: { configKey } });
  if (!existing) {
    await prisma.appConfig.create({ data: { configKey, configValue } });
    console.log(`Seed: created config '${configKey}'`);
    return;
  }
  console.log(`Seed: config '${configKey}' already exists, skipping`);
}

async function ensureDefaultSpace() {
  let space = await prisma.drSpace.findFirst({
    where: { name: DEFAULT_SPACE_NAME },
    orderBy: { createdAt: "asc" },
  });

  if (!space) {
    space = await prisma.drSpace.create({
      data: {
        spaceId: DEFAULT_SPACE_ID,
        name: DEFAULT_SPACE_NAME,
        description: DEFAULT_SPACE_DESCRIPTION,
        inviteCode: DEFAULT_SPACE_INVITE_CODE,
      },
    });
    console.log(`Seed: created default DeepRead space '${DEFAULT_SPACE_NAME}'`);
  } else {
    console.log(`Seed: default DeepRead space '${DEFAULT_SPACE_NAME}' already exists, skipping`);
  }

  const existingConfig = await prisma.appConfig.findUnique({ where: { configKey: "dr_default_space_id" } });
  if (!existingConfig) {
    await prisma.appConfig.create({
      data: { configKey: "dr_default_space_id", configValue: JSON.stringify(space.spaceId) },
    });
    console.log(`Seed: created config 'dr_default_space_id' = ${space.spaceId}`);
    return;
  }

  let currentSpaceId: string | null = null;
  try {
    currentSpaceId = JSON.parse(existingConfig.configValue) as string;
  } catch {
    currentSpaceId = null;
  }

  if (currentSpaceId === space.spaceId) {
    console.log("Seed: config 'dr_default_space_id' already valid, skipping");
    return;
  }

  await prisma.appConfig.update({
    where: { configKey: "dr_default_space_id" },
    data: { configValue: JSON.stringify(space.spaceId) },
  });
  console.log(`Seed: repaired config 'dr_default_space_id' -> ${space.spaceId}`);
}

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

  await ensureConfig("dr_ai_default_daily_limit", String(DR_AI_DEFAULT_DAILY_LIMIT));
  await ensureConfig("dr_guest_daily_limit", "3");
  await ensureDefaultSpace();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
