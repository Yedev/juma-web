import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;
let warnLogged = false;

function createClient(): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) {
        if (!warnLogged) {
          console.warn("[redis] connection failed after 3 retries, falling back to DB");
          warnLogged = true;
        }
        return null; // stop retrying
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  client.on("error", (err) => {
    if (!warnLogged) {
      console.warn("[redis] connection error:", (err as Error).message);
      warnLogged = true;
    }
  });

  client.on("connect", () => {
    console.log("[redis] connected to", REDIS_URL);
    warnLogged = false;
  });

  return client;
}

/**
 * Get the Redis client singleton. Returns null if Redis is unavailable.
 * All callers should handle null gracefully by falling back to DB.
 */
export function getRedis(): Redis | null {
  if (redis) return redis;
  try {
    redis = createClient();
    // Attempt connection; if it fails, the error handler will suppress it
    void redis.ping().catch(() => {
      // Connection failed — redis object stays but commands will fail gracefully
    });
    return redis;
  } catch {
    return null;
  }
}

export default getRedis;
