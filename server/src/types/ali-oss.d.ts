declare module "ali-oss" {
  interface OSSOptions {
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
    endpoint?: string;
    timeout?: string | number;
  }

  interface PutObjectResult {
    name: string;
    url: string;
    res: { status: number; headers: Record<string, string> };
  }

  interface DeleteObjectResult {
    res: { status: number; headers: Record<string, string> };
  }

  interface SignUrlOptions {
    expires?: number;
    method?: string;
    "Content-Type"?: string;
    response?: {
      "content-type"?: string;
      "content-disposition"?: string;
    };
  }

  class OSS {
    constructor(options: OSSOptions);
    put(name: string, data: Buffer | NodeJS.ReadableStream | string, options?: Record<string, unknown>): Promise<PutObjectResult>;
    delete(name: string): Promise<DeleteObjectResult>;
    signatureUrl(name: string, options?: SignUrlOptions): string;
  }

  export = OSS;
}
