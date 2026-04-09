import { Router, Response } from "express";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import prisma from "../../lib/prisma";
import * as statsService from "../../services/deepread/drStatsService";

const router = Router();

// 上报阅读统计
router.post("/reading-stats", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const includeTodaySummary = req.query.include_today_summary === "true";
    const { article_id, reading_time_seconds, scroll_depth, session_start, session_end } = req.body as {
      article_id?: string;
      reading_time_seconds?: number;
      scroll_depth?: number;
      session_start?: string;
      session_end?: string;
    };

    if (!article_id) {
      res.status(400).json({ code: 400, message: "article_id 不能为空" });
      return;
    }

    const article = await prisma.drArticle.findUnique({ where: { articleId: article_id } });
    if (!article) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    const stats = await statsService.createReadingStats(req.drUserId!, {
      article_id,
      reading_time_seconds,
      scroll_depth,
      session_start,
      session_end,
    });

    const baseData = {
      statsId: stats.statsId,
      articleId: stats.articleId,
      readingTimeSeconds: Math.floor(stats.readingTimeMs / 1000),
      scrollDepth: stats.scrollDepth,
      createdAt: stats.createdAt,
    };

    if (includeTodaySummary) {
      const summary = await statsService.getTodaySummary(req.drUserId!);
      res.json({ code: 200, message: "统计已记录", data: { ...baseData, ...summary } });
    } else {
      res.json({ code: 200, message: "统计已上报", data: baseData });
    }
  } catch (error) {
    handleError(res, "Create reading stats error", error);
  }
});

// 批量上报
router.post("/reading-stats/batch", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { stats } = req.body as {
      stats?: Array<{
        article_id: string;
        reading_time_seconds: number;
        scroll_depth: number;
        session_start: string;
        session_end: string;
      }>;
    };

    if (!Array.isArray(stats) || stats.length === 0) {
      res.status(400).json({ code: 400, message: "stats 不能为空" });
      return;
    }

    if (stats.length > 100) {
      res.status(400).json({ code: 400, message: "单次最多上报 100 条统计" });
      return;
    }

    const count = await statsService.batchCreateStats(req.drUserId!, stats);

    if (count === 0) {
      res.json({ code: 200, message: "无有效统计数据", data: { count: 0 } });
      return;
    }

    res.json({ code: 200, message: "统计已批量上报", data: { count } });
  } catch (error) {
    handleError(res, "Batch create reading stats error", error);
  }
});

// 获取统计汇总
router.get("/stats/summary", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const period = (req.query.period as string) || "all";
    const data = await statsService.getStatsSummary(req.drUserId!, period);
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Get stats summary error", error);
  }
});

export default router;
