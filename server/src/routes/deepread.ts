import { Router } from "express";
import { signMiddleware } from "../middleware/sign";
import { drAuthMiddleware, DrAuthRequest } from "../middleware/drAuth";
import { guestGuard } from "../middleware/guestGuard";

import authRoutes from "./dr/auth";
import articleRoutes from "./dr/articles";
import homepageRoutes from "./dr/homepage";
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
router.use(guestGuard);

// 2.4 Get current user profile
router.get("/me", async (req: DrAuthRequest, res) => {
  try {
    const profile = await authService.getUserProfile(req.drUserId!);
    if (!profile) {
      res.status(404).json({ code: 404, message: "用户不存在" });
      return;
    }
    res.json({ code: 200, data: profile });
  } catch (error) {
    handleError(res, "Get profile error", error);
  }
});

// 2.5 Update nickname
router.put("/me/nickname", async (req: DrAuthRequest, res) => {
  try {
    const { nickname } = req.body as { nickname?: string };
    if (!nickname || !nickname.trim()) {
      res.status(400).json({ code: 400, message: "昵称不能为空" });
      return;
    }
    if (nickname.trim().length > 20) {
      res.status(400).json({ code: 400, message: "昵称不能超过20个字符" });
      return;
    }
    const user = await authService.updateUserNickname(req.drUserId!, nickname.trim());
    res.json({ code: 200, message: "修改成功", data: user });
  } catch (error) {
    handleError(res, "Update nickname error", error);
  }
});

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
router.use(homepageRoutes);
router.use(syncRoutes);
router.use(aiRoutes);

export default router;
