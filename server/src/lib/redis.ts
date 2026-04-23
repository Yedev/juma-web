import Redis from "ioredis";
import logger from "./logger";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const log = logger.child({ module: "redis" });

let redis: Redis | null = null;
let available = false;

function createClient(): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) {
        log.warn({ times }, "connection failed after retries, falling back to DB");
        return null; // stop retrying
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  client.on("error", (err) => {
    if (available) {
      log.warn({ err: (err as Error).message }, "connection error");
      available = false;
    }
  });

  client.on("connect", () => {
    log.info({ url: REDIS_URL }, "connected");
    available = true;
  });

  client.on("close", () => {
    available = false;
  });

  void client.connect().catch((err) => {
    log.debug({ err: (err as Error).message }, "initial connect failed");
  });

  return client;
}

/**
 * Get the Redis client singleton. Returns null if Redis is unavailable.
 * All callers should handle null gracefully by falling back to DB.
 */
export function getRedis(): Redis | null {
  if (!redis) {
    try {
      redis = createClient();
    } catch (err) {
      log.error({ err }, "createClient threw");
      return null;
    }
  }
  return available ? redis : null;
}

export default getRedis;
