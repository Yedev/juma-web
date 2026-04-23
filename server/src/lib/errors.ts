import type { Request, Response } from "express";
import logger from "./logger";

export function handleError(res: Response, context: string, error: unknown, req?: Request): void {
  const log = (req as (Request & { log?: typeof logger }) | undefined)?.log ?? logger;
  log.error({ err: error, context }, context);
  if (res.headersSent) return;
  res.status(500).json({ code: 500, message: "服务器内部错误" });
}
