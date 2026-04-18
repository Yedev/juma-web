import OSS from "ali-oss";

const ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID;
const ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET;
const BUCKET = process.env.OSS_BUCKET;
const REGION = process.env.OSS_REGION;

let client: OSS | null = null;
let initFailed = false;

function createClient(): OSS | null {
  try {
    const c = new OSS({
      region: REGION!,
      accessKeyId: ACCESS_KEY_ID!,
      accessKeySecret: ACCESS_KEY_SECRET!,
      bucket: BUCKET!,
    });
    console.log(`[oss] client initialized, bucket=${BUCKET}, region=${REGION}`);
    return c;
  } catch (err) {
    console.error("[oss] client initialization failed:", (err as Error).message);
    initFailed = true;
    return null;
  }
}

export function getOssClient(): OSS | null {
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !BUCKET || !REGION) return null;
  if (initFailed) return null;
  if (!client) client = createClient();
  return client;
}

export default getOssClient;
