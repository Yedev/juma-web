import fs from "fs";
import path from "path";
import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { isOssAvailable, uploadToOss } from "../lib/oss";
import logger from "../lib/logger";

const prisma = new PrismaClient();
const OSS_BACKUP_PREFIX = "db-backups/";
const log = logger.child({ module: "DBBackup" });

function resolveDbPath(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const filePath = url.replace(/^file:/, "");
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

async function runBackup() {
  if (!isOssAvailable()) {
    log.info("OSS unavailable, skip backup");
    return;
  }

  const dbPath = resolveDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    log.error({ dbPath }, "db file not found");
    return;
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ossKey = `${OSS_BACKUP_PREFIX}${timestamp}.db`;

  try {
    log.info({ ossKey }, "backup start");

    await prisma.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE)`;

    const buffer = fs.readFileSync(dbPath);
    await uploadToOss(ossKey, buffer, { contentType: "application/octet-stream" });

    const sizeMB = +(buffer.length / 1024 / 1024).toFixed(2);
    log.info({ ossKey, sizeMB }, "backup done");
  } catch (err) {
    log.error({ err, ossKey }, "backup failed");
  }
}

export function startDbBackupTask() {
  if (!isOssAvailable()) {
    log.info("OSS not configured, backup task not scheduled");
    return;
  }

  log.info("scheduled daily backup at 04:00");
  cron.schedule("0 4 * * *", () => {
    void runBackup();
  });
}
