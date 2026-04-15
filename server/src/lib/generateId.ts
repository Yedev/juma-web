export function generateId(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

export function generateStatsId(): string {
  return generateId("RS");
}

export function generateAnalyticsEventId(): string {
  return generateId("AE");
}
