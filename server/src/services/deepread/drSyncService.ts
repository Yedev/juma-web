import prisma from "../../lib/prisma";
import { generateId, generateStatsId } from "../../lib/generateId";

interface SyncHighlightItem {
  local_id: string;
  action: "create" | "update" | "delete";
  data?: {
    article_id?: string;
    text?: string;
    color?: string;
    position_data?: unknown;
    note?: string;
  };
  remote_id?: string;
}

interface SyncBookmarkItem {
  local_id: string;
  action: "create" | "delete";
  data?: { article_id?: string; bookmarked?: boolean };
}

interface SyncReadProgressItem {
  local_id: string;
  action: "update";
  data?: { article_id?: string; progress?: number };
}

interface SyncReadingStatsItem {
  local_id: string;
  action: "create";
  data?: {
    article_id?: string;
    reading_time_seconds?: number;
    scroll_depth?: number;
    session_start?: string;
    session_end?: string;
  };
}

interface SyncPayload {
  highlights?: SyncHighlightItem[];
  bookmarks?: SyncBookmarkItem[];
  read_progress?: SyncReadProgressItem[];
  reading_stats?: SyncReadingStatsItem[];
}

type SyncResult = { local_id: string; remote_id?: string; status: string; error?: string };

export async function processSync(userId: number, lastSyncAt?: string, payload?: SyncPayload) {
  const results = {
    highlights: [] as SyncResult[],
    bookmarks: [] as SyncResult[],
    read_progress: [] as SyncResult[],
    reading_stats: [] as SyncResult[],
  };

  if (payload?.highlights) {
    for (const item of payload.highlights) {
      try {
        if (item.action === "create" && item.data) {
          const highlight = await prisma.drHighlight.create({
            data: {
              highlightId: generateId("H"),
              userId,
              articleId: item.data.article_id ?? "",
              text: item.data.text ?? "",
              color: item.data.color || "#FFEB3B",
              positionData: item.data.position_data ? JSON.stringify(item.data.position_data) : "{}",
              note: item.data.note || "",
            },
          });
          results.highlights.push({ local_id: item.local_id, remote_id: highlight.highlightId, status: "success" });
        } else if (item.action === "delete" && item.remote_id) {
          const existing = await prisma.drHighlight.findUnique({ where: { highlightId: item.remote_id } });
          if (existing && existing.userId === userId) {
            await prisma.drHighlight.delete({ where: { highlightId: item.remote_id } });
            results.highlights.push({ local_id: item.local_id, status: "success" });
          } else {
            results.highlights.push({ local_id: item.local_id, status: "failed", error: "无权删除或不存在" });
          }
        } else if (item.action === "update" && item.remote_id && item.data) {
          const existing = await prisma.drHighlight.findUnique({ where: { highlightId: item.remote_id } });
          if (existing && existing.userId === userId) {
            const updateData: Record<string, unknown> = {};
            if (item.data.color !== undefined) updateData.color = item.data.color;
            if (item.data.note !== undefined) updateData.note = item.data.note;
            await prisma.drHighlight.update({ where: { highlightId: item.remote_id }, data: updateData });
            results.highlights.push({ local_id: item.local_id, status: "success" });
          } else {
            results.highlights.push({ local_id: item.local_id, status: "failed", error: "无权更新或不存在" });
          }
        }
      } catch (err) {
        results.highlights.push({ local_id: item.local_id, status: "failed", error: String(err) });
      }
    }
  }

  if (payload?.bookmarks) {
    for (const item of payload.bookmarks) {
      try {
        if (item.action === "create" && item.data?.article_id) {
          await prisma.drBookmark.upsert({
            where: { userId_articleId: { userId, articleId: item.data.article_id } },
            update: {},
            create: { userId, articleId: item.data.article_id },
          });
          results.bookmarks.push({ local_id: item.local_id, status: "success" });
        } else if (item.action === "delete" && item.data?.article_id) {
          await prisma.drBookmark.deleteMany({ where: { userId, articleId: item.data.article_id } });
          results.bookmarks.push({ local_id: item.local_id, status: "success" });
        }
      } catch (err) {
        results.bookmarks.push({ local_id: item.local_id, status: "failed", error: String(err) });
      }
    }
  }

  if (payload?.read_progress) {
    for (const item of payload.read_progress) {
      try {
        if (item.action === "update" && item.data?.article_id) {
          await prisma.drReadStatus.upsert({
            where: { userId_articleId: { userId, articleId: item.data.article_id } },
            update: { progress: item.data.progress ?? 100, readAt: new Date() },
            create: { userId, articleId: item.data.article_id, progress: item.data.progress ?? 100 },
          });
          results.read_progress.push({ local_id: item.local_id, status: "success" });
        }
      } catch (err) {
        results.read_progress.push({ local_id: item.local_id, status: "failed", error: String(err) });
      }
    }
  }

  if (payload?.reading_stats) {
    for (const item of payload.reading_stats) {
      try {
        if (item.action === "create" && item.data?.article_id) {
          await prisma.drReadingStats.create({
            data: {
              statsId: generateStatsId(),
              userId,
              articleId: item.data.article_id,
              readingTimeMs: (item.data.reading_time_seconds ?? 0) * 1000,
              scrollDepth: item.data.scroll_depth ?? 0,
              sessionStart: item.data.session_start ? new Date(item.data.session_start) : new Date(),
              sessionEnd: item.data.session_end ? new Date(item.data.session_end) : new Date(),
            },
          });
          results.reading_stats.push({ local_id: item.local_id, status: "success" });
        }
      } catch (err) {
        results.reading_stats.push({ local_id: item.local_id, status: "failed", error: String(err) });
      }
    }
  }

  // 获取服务端变化
  let serverChanges: { highlights: unknown[]; bookmarks: unknown[]; articles: unknown[] } = {
    highlights: [],
    bookmarks: [],
    articles: [],
  };
  if (lastSyncAt) {
    const syncDate = new Date(lastSyncAt);
    const updatedHighlights = await prisma.drHighlight.findMany({
      where: { userId, updatedAt: { gte: syncDate } },
    });
    serverChanges = {
      highlights: updatedHighlights.map((h) => ({
        highlightId: h.highlightId,
        articleId: h.articleId,
        text: h.text,
        color: h.color,
        note: h.note,
        updatedAt: h.updatedAt,
      })),
      bookmarks: [],
      articles: [],
    };
  }

  return { results, serverChanges };
}

export async function getChanges(
  userId: number,
  lastSyncAt: string,
  entityTypes: string[],
) {
  const syncDate = new Date(lastSyncAt);
  const changes: Record<string, { created: unknown[]; updated: unknown[]; deleted: string[] }> = {};

  if (entityTypes.includes("highlights")) {
    const highlights = await prisma.drHighlight.findMany({
      where: { userId, updatedAt: { gte: syncDate } },
    });
    changes.highlights = {
      created: highlights
        .filter((h) => h.createdAt >= syncDate)
        .map((h) => ({
          highlightId: h.highlightId,
          articleId: h.articleId,
          text: h.text,
          color: h.color,
          positionData: JSON.parse(h.positionData),
          note: h.note,
          createdAt: h.createdAt,
        })),
      updated: highlights
        .filter((h) => h.createdAt < syncDate)
        .map((h) => ({
          highlightId: h.highlightId,
          color: h.color,
          note: h.note,
          updatedAt: h.updatedAt,
        })),
      deleted: [],
    };
  }

  if (entityTypes.includes("bookmarks")) {
    const bookmarks = await prisma.drBookmark.findMany({
      where: { userId, createdAt: { gte: syncDate } },
    });
    changes.bookmarks = {
      created: bookmarks.map((b) => ({ articleId: b.articleId, createdAt: b.createdAt })),
      updated: [],
      deleted: [],
    };
  }

  if (entityTypes.includes("read_progress")) {
    const readStatuses = await prisma.drReadStatus.findMany({
      where: { userId, readAt: { gte: syncDate } },
    });
    changes.read_progress = {
      created: [],
      updated: readStatuses.map((r) => ({ articleId: r.articleId, progress: r.progress, readAt: r.readAt })),
      deleted: [],
    };
  }

  return changes;
}
