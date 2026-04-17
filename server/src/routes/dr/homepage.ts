import { Router, Response } from "express";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import * as authService from "../../services/deepread/drAuthService";
import * as homepageService from "../../services/deepread/drHomepageService";

const router = Router();

// Get space homepage modules
router.get("/spaces/:spaceId/homepage", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;

    if (!(await authService.requireMembership(req.drUserId!, spaceId))) {
      res.status(403).json({ code: 403, message: "您不是该空间的成员" });
      return;
    }

    const data = await homepageService.getHomepageModules(spaceId);
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Get homepage error", error);
  }
});

// 每日一文
router.get("/daily-article", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const data = await homepageService.getDailyArticle(req.drUserId!);
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Get daily article error", error);
  }
});

export default router;
