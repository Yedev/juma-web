import { Router } from "express";
import { signMiddleware } from "../middleware/sign";
import { drAuthMiddleware, DrAuthRequest } from "../middleware/drAuth";

import authRoutes from "./dr/auth";
import articleRoutes from "./dr/articles";
import highlightRoutes from "./dr/highlights";
import collectionRoutes from "./dr/collections";
import homepageRoutes from "./dr/homepage";
import statsRoutes from "./dr/stats";
import syncRoutes from "./dr/sync";
import aiRoutes from "./dr/ai";
import * as authService from "../services/deepread/drAuthService";
import { handleError } from "../lib/errors";

const router = Router();

// All routes use sign middleware
router.use(signMiddleware);

// Auth routes (no drAuth needed)
router.use(authRoutes);

// All routes below require drAuth
router.use(drAuthMiddleware);

// 2.3 Join space by invite code (needs drAuth)
router.post("/space/join", async (req: DrAuthRequest, res) => {
  try {
    const { invite_code } = req.body as { invite_code?: string };
    if (!invite_code) {
      res.status(400).json({ code: 400, message: "邀请码不能为空" });
      return;
    }

    const result = await authService.joinSpace(req.drUserId!, invite_code);
    if ("error" in result) {
      res.status(result.status).json({ code: result.status, message: result.error });
      return;
    }

    res.json({
      code: 200,
      message: result.alreadyMember ? "您已是该空间成员" : "加入成功",
      data: result.data,
    });
  } catch (error) {
    handleError(res, "Join space error", error);
  }
});

router.use(articleRoutes);
router.use(highlightRoutes);
router.use(collectionRoutes);
router.use(homepageRoutes);
router.use(statsRoutes);
router.use(syncRoutes);
router.use(aiRoutes);

export default router;
