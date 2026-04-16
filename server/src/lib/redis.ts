import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;
let available = false;

function createClient(): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) {
        console.warn("[redis] connection failed after 3 retries, falling back to DB");
        return null; // stop retrying
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  client.on("error", (err) => {
    if (available) {
      console.warn("[redis] connection error:", (err as Error).message);
      available = false;
    }
  });

  client.on("connect", () => {
    console.log("[redis] connected to", REDIS_URL);
    available = true;
  });

  client.on("close", () => {
    available = false;
  });

  // Attempt initial connection; errors are handled by the error listener above
  void client.connect().catch(() => {});

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
    } catch {
      return null;
    }
  }
  return available ? redis : null;
}

export default getRedis;
