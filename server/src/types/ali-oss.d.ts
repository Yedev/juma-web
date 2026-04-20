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

  interface ListObjectResult {
    objects?: Array<{ name: string; url: string; size: number; lastModified: string }>;
    prefixes?: string[];
    isTruncated: boolean;
    nextMarker?: string;
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
    list(query: { prefix?: string; "max-keys"?: number; marker?: string }): Promise<ListObjectResult>;
    signatureUrl(name: string, options?: SignUrlOptions): string;
  }

  export = OSS;
}
