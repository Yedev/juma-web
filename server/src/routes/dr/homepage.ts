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
    const spaceId = req.query.spaceId as string | undefined;
    const data = await homepageService.getDailyArticle(req.drUserId!, spaceId);
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Get daily article error", error);
  }
});

// 思维格栅
router.get("/thinking-lattice", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.query.spaceId as string | undefined;
    const data = await homepageService.getThinkingLattice(req.drUserId!, spaceId);
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Get thinking lattice error", error);
  }
});

// 思维格栅历史（分页）
router.get("/thinking-lattice/history", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.query.spaceId as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 10));
    const data = await homepageService.getThinkingLatticeHistory(req.drUserId!, spaceId, page, pageSize);
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Get thinking lattice history error", error);
  }
});

export default router;
