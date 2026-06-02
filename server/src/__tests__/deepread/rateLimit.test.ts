jest.mock("../../lib/redis");

import type { Request, Response } from "express";
import getRedis from "../../lib/redis";
import { rateLimit, smsRateLimit } from "../../middleware/rateLimit";

const mockGetRedis = getRedis as jest.MockedFunction<typeof getRedis>;

function runMiddleware(
  mw: ReturnType<typeof rateLimit>,
  req: Partial<Request>,
): Promise<{ statusCode?: number; body?: unknown; nextCalled: boolean }> {
  return new Promise((resolve) => {
    let statusCode: number | undefined;
    let body: unknown;
    let settled = false;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        if (!settled) {
          settled = true;
          resolve({ statusCode, body, nextCalled: false });
        }
        return this;
      },
    } as unknown as Response;
    const next = () => {
      if (!settled) {
        settled = true;
        resolve({ statusCode, body, nextCalled: true });
      }
    };
    void mw(req as Request, res, next);
  });
}

describe("rateLimit middleware", () => {
  beforeEach(() => {
    mockGetRedis.mockReset();
  });

  it("无 Redis 时应直接放行", async () => {
    mockGetRedis.mockReturnValue(null as never);
    const mw = rateLimit({
      keyPrefix: "t",
      windowSeconds: 60,
      limit: 1,
      keyExtractor: () => "k",
    });
    const result = await runMiddleware(mw, { body: {} });
    expect(result.nextCalled).toBe(true);
  });

  it("keyExtractor 返回 null 时应放行（如缺少手机号）", async () => {
    const incr = jest.fn();
    mockGetRedis.mockReturnValue({ incr } as never);
    const result = await runMiddleware(smsRateLimit, { body: {} });
    expect(result.nextCalled).toBe(true);
    expect(incr).not.toHaveBeenCalled();
  });

  it("首次请求应设置过期并放行", async () => {
    const incr = jest.fn().mockResolvedValue(1);
    const expire = jest.fn().mockResolvedValue(1);
    mockGetRedis.mockReturnValue({ incr, expire } as never);

    const mw = rateLimit({ keyPrefix: "t", windowSeconds: 60, limit: 2, keyExtractor: () => "k" });
    const result = await runMiddleware(mw, { body: {} });

    expect(incr).toHaveBeenCalledWith("ratelimit:t:k");
    expect(expire).toHaveBeenCalledWith("ratelimit:t:k", 60);
    expect(result.nextCalled).toBe(true);
  });

  it("超过限制应返回 429", async () => {
    const incr = jest.fn().mockResolvedValue(3);
    const expire = jest.fn();
    mockGetRedis.mockReturnValue({ incr, expire } as never);

    const mw = rateLimit({
      keyPrefix: "t",
      windowSeconds: 60,
      limit: 2,
      keyExtractor: () => "k",
      errorMessage: "太快了",
    });
    const result = await runMiddleware(mw, { body: {} });

    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(429);
    expect((result.body as { message: string }).message).toBe("太快了");
    // expire only set on the first hit
    expect(expire).not.toHaveBeenCalled();
  });

  it("Redis 抛错时应放行（fail-open）", async () => {
    const incr = jest.fn().mockRejectedValue(new Error("redis down"));
    mockGetRedis.mockReturnValue({ incr } as never);

    const mw = rateLimit({ keyPrefix: "t", windowSeconds: 60, limit: 1, keyExtractor: () => "k" });
    const result = await runMiddleware(mw, { body: {} });

    expect(result.nextCalled).toBe(true);
  });
});
