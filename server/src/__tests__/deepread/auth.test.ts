// Mock prisma BEFORE any imports that depend on it
jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});

import request from "supertest";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import {
  createTestApp,
  generateSignHeaders,
  authHeaders,
  generateDrToken,
  TEST_USER,
} from "../setup";

const app = createTestApp();
const SIGN = generateSignHeaders;

describe("DeepRead Auth", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── POST /auth/sms/send ──────────────────────────────

  describe("POST /api/v1/dr/sms/send", () => {
    it("应成功发送验证码", async () => {
      prismaMock.drSmsCode.create.mockResolvedValue({ id: 1 });

      const res = await request(app)
        .post("/api/v1/dr/sms/send")
        .set(SIGN())
        .send({ phone: "13800001111" });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(200);
      expect(res.body.data.code).toBe("888888");
      expect(prismaMock.drSmsCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: "13800001111", code: "888888" }),
        }),
      );
    });

    it("手机号为空时应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/sms/send")
        .set(SIGN())
        .send({ phone: "" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("手机号格式不正确");
    });

    it("手机号不足11位应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/sms/send")
        .set(SIGN())
        .send({ phone: "1380000" });

      expect(res.status).toBe(400);
    });

    it("手机号不以1开头应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/sms/send")
        .set(SIGN())
        .send({ phone: "23800001111" });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /auth/login ──────────────────────────────────

  describe("POST /api/v1/dr/login", () => {
    it("新用户应成功登录并创建用户", async () => {
      prismaMock.drSmsCode.findFirst.mockResolvedValue({ id: 1, phone: "13800002222" });
      prismaMock.drSmsCode.update.mockResolvedValue({});
      prismaMock.drUser.findUnique.mockResolvedValue(null); // new user
      prismaMock.drUser.create.mockResolvedValue({
        id: 10,
        phone: "13800002222",
        nickname: "用户2222",
        avatar: "",
      });
      prismaMock.appConfig.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/dr/login")
        .set(SIGN())
        .send({ phone: "13800002222", code: "888888" });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.phone).toBe("13800002222");
      expect(res.body.data.user.nickname).toBe("用户2222");
      expect(prismaMock.drUser.create).toHaveBeenCalled();
    });

    it("已存在用户应成功登录", async () => {
      prismaMock.drSmsCode.findFirst.mockResolvedValue({ id: 2, phone: "13800001111" });
      prismaMock.drSmsCode.update.mockResolvedValue({});
      prismaMock.drUser.findUnique.mockResolvedValue(TEST_USER);

      const res = await request(app)
        .post("/api/v1/dr/login")
        .set(SIGN())
        .send({ phone: "13800001111", code: "888888" });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.id).toBe(1);
      expect(prismaMock.drUser.create).not.toHaveBeenCalled();
    });

    it("验证码错误应返回 400", async () => {
      prismaMock.drSmsCode.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/dr/login")
        .set(SIGN())
        .send({ phone: "13800002222", code: "000000" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("验证码错误或已过期");
    });

    it("验证码为空应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/login")
        .set(SIGN())
        .send({ phone: "13800002222", code: "" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("验证码不能为空");
    });

    it("手机号格式错误应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/login")
        .set(SIGN())
        .send({ phone: "abc", code: "888888" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("手机号格式不正确");
    });
  });

  // ── POST /space/join ──────────────────────────────────

  describe("POST /api/v1/dr/space/join", () => {
    const token = generateDrToken(1, "13800004444");

    it("应通过有效邀请码加入空间", async () => {
      prismaMock.drInviteCode.findUnique.mockResolvedValue({
        codeId: "cid_1",
        spaceId: "sp_001",
        code: "VALIDCODE",
        disabled: false,
        maxUses: null,
        useCount: 0,
        expiresAt: null,
        codeId_code: "cid_1",
      });
      prismaMock.drSpace.findUnique.mockResolvedValue({
        spaceId: "sp_001",
        name: "测试空间",
        description: "描述",
      });
      prismaMock.drSpaceMember.findUnique.mockResolvedValue(null);
      prismaMock.drSpaceMember.create.mockResolvedValue({});
      prismaMock.drInviteCode.update.mockResolvedValue({});

      const res = await request(app)
        .post("/api/v1/dr/space/join")
        .set(authHeaders(token))
        .send({ invite_code: "VALIDCODE" });

      expect(res.status).toBe(200);
      expect(res.body.data.spaceId).toBe("sp_001");
      expect(res.body.data.name).toBe("测试空间");
    });

    it("已是成员应返回提示信息", async () => {
      prismaMock.drInviteCode.findUnique.mockResolvedValue({
        codeId: "cid_2",
        spaceId: "sp_001",
        code: "VALIDCODE2",
        disabled: false,
        maxUses: null,
        useCount: 0,
        expiresAt: null,
      });
      prismaMock.drSpace.findUnique.mockResolvedValue({
        spaceId: "sp_001",
        name: "测试空间",
        description: "描述",
      });
      prismaMock.drSpaceMember.findUnique.mockResolvedValue({ id: 1 });

      const res = await request(app)
        .post("/api/v1/dr/space/join")
        .set(authHeaders(token))
        .send({ invite_code: "VALIDCODE2" });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch("您已是该空间成员");
    });

    it("无效邀请码应返回 404", async () => {
      prismaMock.drInviteCode.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/dr/space/join")
        .set(authHeaders(token))
        .send({ invite_code: "NOTEXIST" });

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch("邀请码无效");
    });

    it("过期邀请码应返回 400", async () => {
      prismaMock.drInviteCode.findUnique.mockResolvedValue({
        codeId: "cid_3",
        spaceId: "sp_001",
        code: "EXPIRED",
        disabled: false,
        expiresAt: new Date(Date.now() - 1000),
      });

      const res = await request(app)
        .post("/api/v1/dr/space/join")
        .set(authHeaders(token))
        .send({ invite_code: "EXPIRED" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("邀请码已过期");
    });

    it("邀请码次数用尽应返回 400", async () => {
      prismaMock.drInviteCode.findUnique.mockResolvedValue({
        codeId: "cid_4",
        spaceId: "sp_001",
        code: "USEDCODE",
        disabled: false,
        maxUses: 1,
        useCount: 1,
        expiresAt: null,
      });

      const res = await request(app)
        .post("/api/v1/dr/space/join")
        .set(authHeaders(token))
        .send({ invite_code: "USEDCODE" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("使用次数已达上限");
    });

    it("邀请码为空应返回 400", async () => {
      const res = await request(app)
        .post("/api/v1/dr/space/join")
        .set(authHeaders(token))
        .send({ invite_code: "" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch("邀请码不能为空");
    });
  });
});
