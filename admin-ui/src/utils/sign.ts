import CryptoJS from "crypto-js";

const APP_SECRET = "juma2026_secret";

export function generateSign(): { timestamp: string; sign: string } {
  const timestamp = Date.now().toString();
  const sign = CryptoJS.MD5(APP_SECRET + timestamp).toString();
  return { timestamp, sign };
}
