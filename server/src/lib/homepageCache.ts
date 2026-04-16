import getRedis from "./redis";

/**
 * Invalidate the homepage modules cache for a given space.
 * Call this when admin modifies homepage modules or their resources.
 */
export async function invalidateHomepageCache(spaceId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.del(`homepage:modules:${spaceId}`).catch(() => {});
  }
}
