import OSS from "ali-oss";

const ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID;
const ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET;
const BUCKET = process.env.OSS_BUCKET;
const BUCKET_IMG = process.env.OSS_BUCKET_IMG || BUCKET;
const REGION = process.env.OSS_REGION;

const clientMap = new Map<string, OSS>();
let initFailed = false;

function createClient(bucket: string): OSS {
  return new OSS({
    region: REGION!,
    accessKeyId: ACCESS_KEY_ID!,
    accessKeySecret: ACCESS_KEY_SECRET!,
    bucket,
  });
}

/** Get OSS client for a specific bucket (defaults to env OSS_BUCKET) */
export function getOssClient(bucket?: string): OSS | null {
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !REGION) return null;
  if (initFailed) return null;
  const bucketName = bucket || BUCKET;
  if (!bucketName) return null;
  try {
    let client = clientMap.get(bucketName);
    if (!client) {
      client = createClient(bucketName);
      clientMap.set(bucketName, client);
      console.log(`[oss] client initialized, bucket=${bucketName}, region=${REGION}`);
    }
    return client;
  } catch (err) {
    console.error("[oss] client initialization failed:", (err as Error).message);
    initFailed = true;
    return null;
  }
}

/** Check if OSS is available (optionally for a specific bucket) */
export function isOssAvailable(bucket?: string): boolean {
  return getOssClient(bucket) !== null;
}

/** Build the public URL base for a bucket */
export function getOssBaseUrl(bucket?: string): string {
  const bucketName = bucket || BUCKET;
  return `https://${bucketName}.${REGION}.aliyuncs.com`;
}

/** Upload a buffer to OSS, return the public URL */
export async function uploadToOss(key: string, data: Buffer, options?: { contentType?: string; bucket?: string }): Promise<string> {
  const bucketName = options?.bucket;
  const client = getOssClient(bucketName);
  if (!client) throw new Error("OSS not configured");
  const opts = options?.contentType ? { headers: { "Content-Type": options.contentType } } : undefined;
  await client.put(key, data, opts);
  return `${getOssBaseUrl(bucketName)}/${key}`;
}

/** List objects under a prefix */
export async function listOssObjects(prefix: string, bucket?: string): Promise<Array<{ key: string; url: string; size: number; lastModified: Date }>> {
  const client = getOssClient(bucket);
  if (!client) throw new Error("OSS not configured");
  const result = await client.list({ prefix, "max-keys": 1000 });
  return (result.objects || []).map((obj) => ({
    key: obj.name,
    url: `${getOssBaseUrl(bucket)}/${obj.name}`,
    size: obj.size,
    lastModified: new Date(obj.lastModified),
  }));
}

/** Delete an object by key */
export async function deleteFromOss(key: string, bucket?: string): Promise<void> {
  const client = getOssClient(bucket);
  if (!client) throw new Error("OSS not configured");
  await client.delete(key);
}

/** The bucket used for image hosting (OSS_BUCKET_IMG or fallback to OSS_BUCKET) */
export const IMG_BUCKET = BUCKET_IMG;

export default getOssClient;
