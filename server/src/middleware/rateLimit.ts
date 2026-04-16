import { Request, Response, NextFunction } from "express";
import getRedis from "../lib/redis";

interface RateLimitOptions {
  keyPrefix: string;
  windowSeconds: number;
  limit: number;
  keyExtractor: (req: Request) => string | null;
  errorMessage?: string;
}

export function rateLimit(options: RateLimitOptions) {
  const {
    keyPrefix,
    windowSeconds,
    limit,
    keyExtractor,
    errorMessage = "请求过于频繁，请稍后再试",
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const redis = getRedis();
    if (!redis) {
      // No Redis — skip rate limiting
      next();
      return;
    }

    const key = keyExtractor(req);
    if (!key) {
      next();
      return;
    }

    try {
      const redisKey = `ratelimit:${keyPrefix}:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, windowSeconds);
      }

      if (count > limit) {
        res.status(429).json({ code: 429, message: errorMessage });
        return;
      }
    } catch {
      // Redis error — skip rate limiting
    }

    next();
  };
}

/** Rate limit for AI endpoints: 10 requests/minute per user */
export const aiRateLimit = rateLimit({
  keyPrefix: "ai",
  windowSeconds: 60,
  limit: 10,
  keyExtractor: (req) => {
    const drReq = req as { drUserId?: number };
    return drReq.drUserId != null ? String(drReq.drUserId) : null;
  },
  errorMessage: "AI 请求过于频繁，每分钟最多 10 次",
});

/** Rate limit for SMS send-code: 1 request/minute per phone */
export const smsRateLimit = rateLimit({
  keyPrefix: "sms",
  windowSeconds: 60,
  limit: 1,
  keyExtractor: (req) => {
    const { phone } = req.body as { phone?: string };
    return phone || null;
  },
  errorMessage: "验证码发送过于频繁，请 1 分钟后再试",
});
