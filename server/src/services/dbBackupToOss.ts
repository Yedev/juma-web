import fs from "fs";
import path from "path";
import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { getOssClient } from "../lib/oss";

const prisma = new PrismaClient();
const OSS_BACKUP_PREFIX = "db-backups/";

function resolveDbPath(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const filePath = url.replace(/^file:/, "");
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

async function runBackup() {
  const oss = getOssClient();
  if (!oss) {
    console.log("[DBBackup] OSS 不可用，跳过数据库备份。");
    return;
  }

  const dbPath = resolveDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error("[DBBackup] 数据库文件不存在:", dbPath);
    return;
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ossKey = `${OSS_BACKUP_PREFIX}${timestamp}.db`;

  try {
    console.log(`[DBBackup] 开始备份数据库到 OSS: ${ossKey}`);

    await prisma.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE)`;

    const buffer = fs.readFileSync(dbPath);
    await oss.put(ossKey, buffer);

    const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    console.log(`[DBBackup] 备份完成: ${ossKey} (${sizeMB} MB)`);
  } catch (error) {
    console.error("[DBBackup] 备份失败:", error);
  }
}

export function startDbBackupTask() {
  const oss = getOssClient();
  if (!oss) {
    console.log("[DBBackup] OSS 未配置，数据库备份任务未启动。");
    return;
  }

  console.log("[DBBackup] 每天凌晨 4:00 备份数据库到 OSS 的定时任务已挂载。");
  cron.schedule("0 4 * * *", () => {
    void runBackup();
  });
}
