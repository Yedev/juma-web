import prisma from "../../lib/prisma";
import { generateStatsId } from "../../lib/generateId";

interface StatsInput {
  article_id: string;
  reading_time_seconds?: number;
  scroll_depth?: number;
  session_start?: string;
  session_end?: string;
}

export async function createReadingStats(userId: number, input: StatsInput) {
  return prisma.drReadingStats.create({
    data: {
      statsId: generateStatsId(),
      userId,
      articleId: input.article_id,
      readingTimeMs: (input.reading_time_seconds ?? 0) * 1000,
      scrollDepth: input.scroll_depth ?? 0,
      sessionStart: input.session_start ? new Date(input.session_start) : new Date(),
      sessionEnd: input.session_end ? new Date(input.session_end) : new Date(),
    },
  });
}

export async function getTodaySummary(userId: number) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayStats = await prisma.drReadingStats.findMany({
    where: { userId, createdAt: { gte: todayStart } },
    select: { articleId: true, readingTimeMs: true },
  });

  return {
    total_reading_time_today: Math.floor(todayStats.reduce((sum, s) => sum + s.readingTimeMs, 0) / 1000),
    articles_read_today: new Set(todayStats.map((s) => s.articleId)).size,
  };
}

export async function batchCreateStats(userId: number, stats: StatsInput[]) {
  const articleIds = [...new Set(stats.map((s) => s.article_id))];
  const articles = await prisma.drArticle.findMany({
    where: { articleId: { in: articleIds } },
  });
  const validArticleIds = new Set(articles.map((a) => a.articleId));

  const createData = stats
    .filter((s) => validArticleIds.has(s.article_id))
    .map((s) => ({
      statsId: generateStatsId(),
      userId,
      articleId: s.article_id,
      readingTimeMs: (s.reading_time_seconds ?? 0) * 1000,
      scrollDepth: s.scroll_depth ?? 0,
      sessionStart: s.session_start ? new Date(s.session_start) : new Date(),
      sessionEnd: s.session_end ? new Date(s.session_end) : new Date(),
    }));

  if (createData.length > 0) {
    await prisma.drReadingStats.createMany({ data: createData });
  }
  return createData.length;
}

export async function getStatsSummary(userId: number, period: string) {
  let startDate: Date | null = null;
  const now = new Date();
  switch (period) {
    case "today":
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      break;
    case "week":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "month":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }

  const whereClause = startDate ? { userId, createdAt: { gte: startDate } } : { userId };

  const [stats, highlightCount, bookmarkCount] = await Promise.all([
    prisma.drReadingStats.findMany({
      where: whereClause,
      select: { articleId: true, readingTimeMs: true },
    }),
    prisma.drHighlight.count({ where: { userId } }),
    prisma.drBookmark.count({ where: { userId } }),
  ]);

  const streakDays = await calculateStreak(userId);

  const uniqueArticles = new Set(stats.map((s) => s.articleId));
  const totalReadingTimeMs = stats.reduce((sum, s) => sum + s.readingTimeMs, 0);

  return {
    total_reading_time_seconds: Math.floor(totalReadingTimeMs / 1000),
    total_articles_read: uniqueArticles.size,
    total_highlights: highlightCount,
    total_notes: highlightCount,
    reading_streak_days: streakDays,
  };
}

async function calculateStreak(userId: number): Promise<number> {
  // 使用数据库按天分组，避免加载全部记录
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);

  const dailyStats = await prisma.drReadingStats.groupBy({
    by: ["createdAt"],
    where: { userId, createdAt: { gte: yearAgo } },
    _count: true,
  });

  // 提取有记录的日期集合（只保留日期部分）
  const daysWithStats = new Set(dailyStats.map((s) => new Date(s.createdAt).toDateString()));

  let streakDays = 0;
  for (let i = 0; i < 365; i++) {
    const checkDate = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    if (daysWithStats.has(checkDate.toDateString())) {
      streakDays++;
    } else if (i > 0) {
      break;
    }
  }
  return streakDays;
}
