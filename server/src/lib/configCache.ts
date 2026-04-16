import prisma from "./prisma";
import getRedis from "./redis";

const CONFIG_TTL = 60; // seconds

/**
 * Get an AppConfig value with Redis cache-aside pattern.
 * Falls back to DB if Redis is unavailable.
 */
export async function getConfig(key: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    const cached = await redis.get(`config:${key}`);
    if (cached !== null) return cached;
  }

  const record = await prisma.appConfig.findUnique({ where: { configKey: key } });
  const value = record?.configValue ?? null;

  if (value !== null && redis) {
    await redis.set(`config:${key}`, value, "EX", CONFIG_TTL).catch(() => {});
  }
  return value;
}

/**
 * Invalidate a cached config key. Call this after admin updates.
 */
export async function invalidateConfig(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.del(`config:${key}`).catch(() => {});
  }
}
