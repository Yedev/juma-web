import { Router, Response } from "express";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import * as highlightService from "../../services/deepread/drHighlightService";

const router = Router();

// 4.1 Create highlight
router.post("/highlights", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { article_id, text, color, position_data, note } = req.body as {
      article_id?: string;
      text?: string;
      color?: string;
      position_data?: unknown;
      note?: string;
    };

    if (!article_id || !text) {
      res.status(400).json({ code: 400, message: "article_id 和 text 不能为空" });
      return;
    }

    const highlight = await highlightService.createHighlight(
      req.drUserId!,
      article_id,
      text,
      color,
      position_data,
      note,
    );

    res.json({
      code: 200,
      message: "批注已创建",
      data: {
        highlightId: highlight.highlightId,
        articleId: highlight.articleId,
        text: highlight.text,
        color: highlight.color,
        positionData: JSON.parse(highlight.positionData),
        note: highlight.note,
        createdAt: highlight.createdAt,
      },
    });
  } catch (error) {
    handleError(res, "Create highlight error", error);
  }
});

// 4.2 Get highlights for article
router.get("/highlights", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.query.article_id as string;
    if (!articleId) {
      res.status(400).json({ code: 400, message: "article_id 不能为空" });
      return;
    }

    const data = await highlightService.getHighlights(req.drUserId!, articleId);
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Get highlights error", error);
  }
});

export default router;
