import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../middleware/auth";
import logger from "../lib/logger";

const router = Router();
const prisma = new PrismaClient();
const log = logger.child({ module: "adminAuth" });

router.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ code: 400, message: "请输入账号和密码" });
      return;
    }

    const user = await prisma.adminUser.findUnique({
      where: { username },
    });

    if (!user) {
      log.warn({ username, ip: req.ip }, "admin login failed: user not found");
      res.status(401).json({ code: 401, message: "账号或密码错误" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      log.warn({ username, ip: req.ip }, "admin login failed: bad password");
      res.status(401).json({ code: 401, message: "账号或密码错误" });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    log.info({ adminId: user.id, username, ip: req.ip }, "admin.login");

    res.json({
      code: 200,
      message: "登录成功",
      data: { token, username: user.username },
    });
  } catch (error) {
    log.error({ err: error }, "admin login error");
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

export default router;
