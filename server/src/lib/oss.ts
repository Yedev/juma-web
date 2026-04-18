import OSS from "ali-oss";

const ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID;
const ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET;
const BUCKET = process.env.OSS_BUCKET;
const REGION = process.env.OSS_REGION;

let client: OSS | null = null;

function createClient(): OSS {
  return new OSS({
    region: REGION!,
    accessKeyId: ACCESS_KEY_ID!,
    accessKeySecret: ACCESS_KEY_SECRET!,
    bucket: BUCKET!,
  });
}

export function getOssClient(): OSS | null {
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !BUCKET || !REGION) {
    return null;
  }
  if (!client) {
    client = createClient();
    console.log(`[oss] client initialized, bucket=${BUCKET}, region=${REGION}`);
  }
  return client;
}

export default getOssClient;
