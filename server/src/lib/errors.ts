import { Response } from "express";

export function handleError(res: Response, context: string, error: unknown): void {
  console.error(`${context}:`, error);
  res.status(500).json({ code: 500, message: "服务器内部错误" });
}
