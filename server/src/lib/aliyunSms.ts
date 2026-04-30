import { $OpenApiUtil } from "@alicloud/openapi-core";
import Dypnsapi, {
  SendSmsVerifyCodeRequest,
  CheckSmsVerifyCodeRequest,
} from "@alicloud/dypnsapi20170525";

export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
  schemeName?: string;
  codeLength?: number;
  validTime?: number;
  interval?: number;
  codeType?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  duplicatePolicy?: 1 | 2;
  autoRetry?: boolean;
}

export interface SendResult {
  success: boolean;
  bizId?: string;
  verifyCode?: string;
  requestId?: string;
  outId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface CheckResult {
  success: boolean;
  verifyResult?: "PASS" | "UNKNOWN";
  passed: boolean;
  requestId?: string;
  outId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export class AliyunSmsVerify {
  private client: Dypnsapi;
  private config: Required<AliyunSmsConfig>;

  constructor(config: AliyunSmsConfig) {
    this.config = {
      schemeName: "默认方案",
      codeLength: 6,
      validTime: 300,
      interval: 60,
      codeType: 1,
      duplicatePolicy: 1,
      autoRetry: true,
      ...config,
    };

    const clientConfig = new $OpenApiUtil.Config({
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      endpoint: "dypnsapi.aliyuncs.com",
    });

    this.client = new Dypnsapi(clientConfig);
  }

  async send(phoneNumber: string, outId?: string, returnVerifyCode = false): Promise<SendResult> {
    if (!this.isValidPhone(phoneNumber)) {
      return { success: false, errorCode: "INVALID_PHONE", errorMessage: "手机号格式不正确" };
    }

    const minStr = String(Math.ceil(this.config.validTime / 60));

    const request = new SendSmsVerifyCodeRequest({
      phoneNumber,
      signName: this.config.signName,
      templateCode: this.config.templateCode,
      templateParam: JSON.stringify({ code: "##code##", min: minStr }),
      schemeName: this.config.schemeName,
      codeLength: this.config.codeLength,
      validTime: this.config.validTime,
      interval: this.config.interval,
      codeType: this.config.codeType,
      duplicatePolicy: this.config.duplicatePolicy,
      autoRetry: this.config.autoRetry ? 1 : 0,
      returnVerifyCode,
      countryCode: "86",
      ...(outId ? { outId } : {}),
    });

    try {
      const resp = await this.client.sendSmsVerifyCode(request);
      const body = resp?.body;
      if (!body) return { success: false, errorCode: "EMPTY_RESPONSE", errorMessage: "响应为空" };
      if (body.code === "OK" && body.success) {
        return {
          success: true,
          bizId: body.model?.bizId,
          verifyCode: body.model?.verifyCode,
          requestId: body.requestId,
          outId: body.model?.outId,
        };
      }
      return { success: false, requestId: body.requestId, errorCode: body.code ?? undefined, errorMessage: body.message ?? undefined };
    } catch (err: any) {
      return { success: false, errorCode: err?.code ?? "UNKNOWN_ERROR", errorMessage: err?.message ?? "请求异常" };
    }
  }

  async verify(phoneNumber: string, verifyCode: string, outId?: string): Promise<CheckResult> {
    if (!this.isValidPhone(phoneNumber)) {
      return { success: false, passed: false, errorCode: "INVALID_PHONE", errorMessage: "手机号格式不正确" };
    }

    if (!verifyCode?.trim()) {
      return { success: false, passed: false, errorCode: "INVALID_CODE", errorMessage: "验证码不能为空" };
    }

    const request = new CheckSmsVerifyCodeRequest({
      phoneNumber,
      verifyCode: verifyCode.trim(),
      schemeName: this.config.schemeName,
      countryCode: "86",
      caseAuthPolicy: 1,
      ...(outId ? { outId } : {}),
    });

    try {
      const resp = await this.client.checkSmsVerifyCode(request);
      const body = resp?.body;
      if (!body) return { success: false, passed: false, errorCode: "EMPTY_RESPONSE", errorMessage: "响应为空" };
      const passed = body.model?.verifyResult === "PASS";
      return {
        success: body.code === "OK" && (body.success ?? false),
        verifyResult: body.model?.verifyResult as "PASS" | "UNKNOWN" | undefined,
        passed,
        requestId: body.requestId,
        outId: body.model?.outId,
        ...(body.code !== "OK" ? { errorCode: body.code ?? undefined, errorMessage: body.message ?? undefined } : {}),
      };
    } catch (err: any) {
      return { success: false, passed: false, errorCode: err?.code ?? "UNKNOWN_ERROR", errorMessage: err?.message ?? "请求异常" };
    }
  }

  private isValidPhone(phone: string): boolean {
    return /^1[3-9]\d{9}$/.test(phone);
  }
}

// Singleton built from env vars; null when SMS is not configured.
const {
  ALIYUN_SMS_ACCESS_KEY_ID,
  ALIYUN_SMS_ACCESS_KEY_SECRET,
  ALIYUN_SMS_SIGN_NAME,
  ALIYUN_SMS_TEMPLATE_CODE,
  ALIYUN_SMS_SCHEME_NAME,
} = process.env;

export const smsClient: AliyunSmsVerify | null =
  ALIYUN_SMS_ACCESS_KEY_ID && ALIYUN_SMS_ACCESS_KEY_SECRET && ALIYUN_SMS_SIGN_NAME && ALIYUN_SMS_TEMPLATE_CODE
    ? new AliyunSmsVerify({
        accessKeyId: ALIYUN_SMS_ACCESS_KEY_ID,
        accessKeySecret: ALIYUN_SMS_ACCESS_KEY_SECRET,
        signName: ALIYUN_SMS_SIGN_NAME,
        templateCode: ALIYUN_SMS_TEMPLATE_CODE,
        ...(ALIYUN_SMS_SCHEME_NAME ? { schemeName: ALIYUN_SMS_SCHEME_NAME } : {}),
      })
    : null;
