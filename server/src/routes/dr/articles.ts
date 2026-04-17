import { Router, Response } from "express";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import * as authService from "../../services/deepread/drAuthService";
import * as articleService from "../../services/deepread/drArticleService";

const router = Router();

// 3.1 Get articles list
router.get("/articles", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.query.space_id as string;
    const channelId = req.query.channel_id as string | undefined;
    const collectionId = req.query.collection_id as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 20;

    if (!spaceId) {
      res.status(400).json({ code: 400, message: "space_id 不能为空" });
      return;
    }

    if (!(await authService.requireMembership(req.drUserId!, spaceId))) {
      res.status(403).json({ code: 403, message: "您不是该空间的成员" });
      return;
    }

    const result = await articleService.getArticlesList(spaceId, {
      channelId,
      collectionId,
      page,
      pageSize,
    });

    if (!result) {
      res.status(404).json({ code: 404, message: "合集不存在" });
      return;
    }

    res.json({ code: 200, message: "success", data: result });
  } catch (error) {
    handleError(res, "Get articles error", error);
  }
});

// 3.2 Get article detail
router.get("/articles/:articleId", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.params.articleId as string;

    const data = await articleService.getArticleDetail(articleId);
    if (!data) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    if (!(await authService.requireMembership(req.drUserId!, data.spaceId))) {
      res.status(403).json({ code: 403, message: "您不是该空间的成员" });
      return;
    }

    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Get article detail error", error);
  }
});


export default router;
