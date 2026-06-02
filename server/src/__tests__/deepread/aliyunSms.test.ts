const mockSend = jest.fn();
const mockCheck = jest.fn();

jest.mock("@alicloud/dypnsapi20170525", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    sendSmsVerifyCode: mockSend,
    checkSmsVerifyCode: mockCheck,
  })),
  SendSmsVerifyCodeRequest: jest.fn().mockImplementation((x) => x),
  CheckSmsVerifyCodeRequest: jest.fn().mockImplementation((x) => x),
}));

jest.mock("@alicloud/openapi-core", () => ({
  __esModule: true,
  $OpenApiUtil: { Config: jest.fn().mockImplementation((x) => x) },
}));

import { AliyunSmsVerify } from "../../lib/aliyunSms";

const client = new AliyunSmsVerify({
  accessKeyId: "id",
  accessKeySecret: "secret",
  signName: "签名",
  templateCode: "T001",
});

describe("AliyunSmsVerify.send", () => {
  beforeEach(() => mockSend.mockReset());

  it("手机号非法时应直接返回 INVALID_PHONE", async () => {
    const r = await client.send("12345");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("INVALID_PHONE");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("接口返回 OK 时应成功并带回 bizId", async () => {
    mockSend.mockResolvedValue({
      body: { code: "OK", success: true, requestId: "req1", model: { bizId: "biz1" } },
    });
    const r = await client.send("13800001111");
    expect(r.success).toBe(true);
    expect(r.bizId).toBe("biz1");
    expect(r.requestId).toBe("req1");
  });

  it("接口返回错误码时应失败并带回 errorCode", async () => {
    mockSend.mockResolvedValue({
      body: { code: "isv.BUSINESS_LIMIT_CONTROL", success: false, message: "频繁", requestId: "req2" },
    });
    const r = await client.send("13800001111");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("isv.BUSINESS_LIMIT_CONTROL");
    expect(r.errorMessage).toBe("频繁");
  });

  it("响应体为空时应返回 EMPTY_RESPONSE", async () => {
    mockSend.mockResolvedValue({ body: null });
    const r = await client.send("13800001111");
    expect(r.errorCode).toBe("EMPTY_RESPONSE");
  });

  it("请求抛错时应捕获并返回错误", async () => {
    mockSend.mockRejectedValue({ code: "NetworkError", message: "超时" });
    const r = await client.send("13800001111");
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("NetworkError");
    expect(r.errorMessage).toBe("超时");
  });
});

describe("AliyunSmsVerify.verify", () => {
  beforeEach(() => mockCheck.mockReset());

  it("手机号非法时应返回 INVALID_PHONE", async () => {
    const r = await client.verify("12345", "123456");
    expect(r.passed).toBe(false);
    expect(r.errorCode).toBe("INVALID_PHONE");
  });

  it("验证码为空时应返回 INVALID_CODE", async () => {
    const r = await client.verify("13800001111", "   ");
    expect(r.passed).toBe(false);
    expect(r.errorCode).toBe("INVALID_CODE");
  });

  it("验证通过时 passed 为 true", async () => {
    mockCheck.mockResolvedValue({
      body: { code: "OK", success: true, requestId: "req3", model: { verifyResult: "PASS" } },
    });
    const r = await client.verify("13800001111", "123456");
    expect(r.passed).toBe(true);
    expect(r.verifyResult).toBe("PASS");
  });

  it("验证未通过时 passed 为 false", async () => {
    mockCheck.mockResolvedValue({
      body: { code: "OK", success: true, model: { verifyResult: "UNKNOWN" } },
    });
    const r = await client.verify("13800001111", "000000");
    expect(r.passed).toBe(false);
  });

  it("响应体为空时应返回 EMPTY_RESPONSE", async () => {
    mockCheck.mockResolvedValue({ body: null });
    const r = await client.verify("13800001111", "123456");
    expect(r.errorCode).toBe("EMPTY_RESPONSE");
  });

  it("请求抛错时应捕获并返回错误", async () => {
    mockCheck.mockRejectedValue({ code: "Boom", message: "炸了" });
    const r = await client.verify("13800001111", "123456");
    expect(r.passed).toBe(false);
    expect(r.errorCode).toBe("Boom");
  });
});
