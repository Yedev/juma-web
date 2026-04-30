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

    const { devCode } = await authService.sendSmsCode(phone);

    res.json({
      code: 200,
      message: "验证码已发送",
      ...(devCode !== undefined ? { data: { code: devCode } } : {}),
    });
  } catch (error) {
    handleError(res, "SMS send error", error);
  }
});

// Guest login
router.post("/guest/login", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { device_id, platform } = req.body as { device_id?: string; platform?: string };

    if (!device_id || typeof device_id !== "string" || device_id.trim().length < 8) {
      res.status(400).json({ code: 400, message: "device_id 格式不正确" });
      return;
    }

    const result = await authService.loginAsGuest(device_id.trim(), platform);

    res.json({
      code: 200,
      message: "游客登录成功",
      data: {
        token: result.token,
        user: {
          id: result.user.id,
          role: result.user.role,
          nickname: result.user.nickname,
          avatar: result.user.avatar,
        },
      },
    });
  } catch (error) {
    handleError(res, "Guest login error", error);
  }
});

// 2.2 Login with SMS code
router.post("/login", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, code, device_id, platform } = req.body as { phone?: string; code?: string; device_id?: string; platform?: string };

    if (!phone || !/^1\d{10}$/.test(phone)) {
      res.status(400).json({ code: 400, message: "手机号格式不正确" });
      return;
    }
    if (!code) {
      res.status(400).json({ code: 400, message: "验证码不能为空" });
      return;
    }

    const result = await authService.loginWithSms(phone, code, device_id, platform);
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

export default router;
