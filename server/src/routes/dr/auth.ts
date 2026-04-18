import { Router, Response } from "express";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import { smsRateLimit } from "../../middleware/rateLimit";
import * as authService from "../../services/deepread/drAuthService";

const router = Router();

// 2.1 Send SMS code
router.post("/sms/send", smsRateLimit, async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { phone } = req.body as { phone?: string };

    if (!phone || !/^1\d{10}$/.test(phone)) {
      res.status(400).json({ code: 400, message: "手机号格式不正确" });
      return;
    }

    const code = await authService.sendSmsCode(phone);

    res.json({
      code: 200,
      message: "验证码已发送",
      data: { code }, // Dev only
    });
  } catch (error) {
    handleError(res, "SMS send error", error);
  }
});

// 2.2 Login with SMS code
router.post("/login", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, code } = req.body as { phone?: string; code?: string };

    if (!phone || !/^1\d{10}$/.test(phone)) {
      res.status(400).json({ code: 400, message: "手机号格式不正确" });
      return;
    }
    if (!code) {
      res.status(400).json({ code: 400, message: "验证码不能为空" });
      return;
    }

    const result = await authService.loginWithSms(phone, code);
    if (!result) {
      res.status(400).json({ code: 400, message: "验证码错误或已过期" });
      return;
    }

    res.json({
      code: 200,
      message: "登录成功",
      data: {
        token: result.token,
        user: {
          id: result.user.id,
          phone: result.user.phone,
          nickname: result.user.nickname,
          avatar: result.user.avatar,
        },
      },
    });
  } catch (error) {
    handleError(res, "Login error", error);
  }
});

// 2.4 Get current user profile
router.get("/me", async (req: DrAuthRequest, res: Response): Promise<void> => {
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
router.put("/me/nickname", async (req: DrAuthRequest, res: Response): Promise<void> => {
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

export default router;
