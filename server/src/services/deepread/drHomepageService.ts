import prisma from "../../lib/prisma";
import getRedis from "../../lib/redis";
import { getConfig } from "../../lib/configCache";

interface CachedModuleData {
  orderedModules: Array<{
    moduleId: string;
    moduleType: string;
    title: string;
    subtitle: string;
    description: string;
    layoutType: string;
    sourceType: string;
    sourceId: string;
  }>;
  resourcesByModule: Record<string, Array<{
    resourceType: string;
    resourceId: string;
    sortOrder: number;
    detail: unknown;
  }>>;
}

async function buildModuleData(spaceId: string): Promise<CachedModuleData | null> {
  const modules = await prisma.drSpaceHomepageModule.findMany({
    where: { spaceId },
    orderBy: { sortOrder: "asc" },
  });

  if (modules.length === 0) return null;

  // load_list modules always appear last
  const nonLoadListModules = modules.filter((m) => m.moduleType !== "load_list");
  const loadListModules = modules.filter((m) => m.moduleType === "load_list");
  const orderedModules = [...nonLoadListModules, ...loadListModules];

  // Fetch resources for standard modules only
  const standardModuleIds = nonLoadListModules
    .filter((m) => m.moduleType === "standard" || !m.moduleType)
    .map((m) => m.moduleId);
  const resources =
    standardModuleIds.length > 0
      ? await prisma.drSpaceHomepageModuleResource.findMany({
          where: { moduleId: { in: standardModuleIds } },
          orderBy: { sortOrder: "asc" },
        })
      : [];

  const channelIds = resources.filter((r) => r.resourceType === "channel").map((r) => r.resourceId);
  const articleIds = resources.filter((r) => r.resourceType === "article").map((r) => r.resourceId);
  const collectionIds = resources.filter((r) => r.resourceType === "collection").map((r) => r.resourceId);

  const [channels, articles, collectionsData] = await Promise.all([
    channelIds.length > 0 ? prisma.drChannel.findMany({ where: { channelId: { in: channelIds } } }) : [],
    articleIds.length > 0
      ? prisma.drArticle.findMany({
          where: { articleId: { in: articleIds } },
          select: {
            articleId: true,
            channelId: true,
            title: true,
            summary: true,
            coverUrl: true,
            layoutType: true,
            author: true,
            readCount: true,
            publishedAt: true,
          },
        })
      : [],
    collectionIds.length > 0
      ? prisma.drSpaceCollection.findMany({ where: { collectionId: { in: collectionIds } } })
      : [],
  ]);

  const channelMap = new Map(channels.map((c) => [c.channelId, c]));
  const articleMap = new Map(articles.map((a) => [a.articleId, a]));
  const collectionMap = new Map(collectionsData.map((c) => [c.collectionId, c]));

  const resourcesByModule: Record<string, Array<{ resourceType: string; resourceId: string; sortOrder: number; detail: unknown }>> = {};
  for (const r of resources) {
    if (!resourcesByModule[r.moduleId]) resourcesByModule[r.moduleId] = [];
    let detail: unknown = null;
    if (r.resourceType === "channel") {
      detail = channelMap.get(r.resourceId) ?? null;
    } else if (r.resourceType === "article") {
      detail = articleMap.get(r.resourceId) ?? null;
    } else if (r.resourceType === "collection") {
      detail = collectionMap.get(r.resourceId) ?? null;
    }
    resourcesByModule[r.moduleId].push({
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      sortOrder: r.sortOrder,
      detail,
    });
  }

  const serializedModules = orderedModules.map((m) => ({
    moduleId: m.moduleId,
    moduleType: m.moduleType || "standard",
    title: m.title,
    subtitle: m.subtitle,
    description: m.description,
    layoutType: m.layoutType,
    sourceType: m.sourceType,
    sourceId: m.sourceId,
  }));

  return { orderedModules: serializedModules, resourcesByModule };
}

export async function getHomepageModules(spaceId: string) {
  const redis = getRedis();
  let moduleData: CachedModuleData | null = null;

  if (redis) {
    const cached = await redis.get(`homepage:modules:${spaceId}`);
    if (cached) {
      try {
        moduleData = JSON.parse(cached);
      } catch { /* fall through */ }
    }
  }

  if (!moduleData) {
    moduleData = await buildModuleData(spaceId);
    if (!moduleData) return [];

    if (redis) {
      await redis.set(`homepage:modules:${spaceId}`, JSON.stringify(moduleData), "EX", 300).catch(() => {});
    }
  }

  const { orderedModules, resourcesByModule } = moduleData;

  return orderedModules.map((m) => {
    const base = { moduleId: m.moduleId, moduleType: m.moduleType, title: m.title };
    if (m.moduleType === "title_desc") {
      return { ...base, description: m.description };
    }
    if (m.moduleType === "load_list") {
      return { ...base, subtitle: m.subtitle, sourceType: m.sourceType, sourceId: m.sourceId };
    }
    const moduleResources = resourcesByModule[m.moduleId] ?? [];
    return { ...base, subtitle: m.subtitle, layoutType: m.layoutType, resources: moduleResources };
  });
}

function getTodayIsoDate(): string {
  return new Date().toISOString().split("T")[0];
}

function parseNodeNames(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  } catch {
    return [];
  }
}

function buildDefaultNodeName(title: string): string {
  const source = title.split(/[：:|｜\-]/)[0]?.trim() || title.trim();
  const compact = source.replace(/[，。！？；、,.!?;()\[\]（）【】"'"]/g, "").replace(/\s+/g, "");
  return compact.slice(0, 6) || title.trim().slice(0, 6);
}

function buildDefaultNodeNames(titles: string[]): string[] {
  const used = new Map<string, number>();
  return titles.map((title) => {
    const base = buildDefaultNodeName(title) || "节点";
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}${count + 1}`;
  });
}

function getCurrentWeekStart(): Date {
  const now = new Date();
  const currentDay = now.getDay();
  const diff = currentDay === 0 ? -6 : 1 - currentDay;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() + diff);
  return weekStart;
}

function formatWeekLabel(weekStart: Date): string {
  const year = weekStart.getFullYear();
  const month = weekStart.toLocaleString("en-US", { month: "long" }).toUpperCase();
  const firstDayOfYear = new Date(year, 0, 1);
  const dayOffset = (firstDayOfYear.getDay() + 6) % 7;
  const firstWeekStart = new Date(firstDayOfYear);
  firstWeekStart.setDate(firstDayOfYear.getDate() - dayOffset);
  firstWeekStart.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((weekStart.getTime() - firstWeekStart.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.floor(diffDays / 7) + 1;
  return `${year} ${month} WEEK ${weekNumber}`;
}

async function resolvePreferredSpaceId(userId: number, requestedSpaceId?: string) {
  const memberships = await prisma.drSpaceMember.findMany({ where: { userId } });

  if (memberships.length === 0) {
    return { ok: false as const, reason: "您还没有加入任何空间" };
  }

  if (requestedSpaceId) {
    if (!memberships.some((m) => m.spaceId === requestedSpaceId)) {
      return { ok: false as const, reason: "您不是该空间的成员" };
    }
    return { ok: true as const, spaceId: requestedSpaceId };
  }

  let spaceId = memberships[0].spaceId;
  const rawDefaultSpaceId = await getConfig("dr_default_space_id");
  if (rawDefaultSpaceId) {
    try {
      const defaultSpaceId = JSON.parse(rawDefaultSpaceId) as string;
      if (memberships.some((m) => m.spaceId === defaultSpaceId)) {
        spaceId = defaultSpaceId;
      }
    } catch {
      // Ignore malformed config and fallback to the first joined space.
    }
  }

  return { ok: true as const, spaceId };
}

export async function getDailyArticle(userId: number, requestedSpaceId?: string) {
  const resolved = await resolvePreferredSpaceId(userId, requestedSpaceId);
  if (!resolved.ok) {
    return { date: getTodayIsoDate(), article: null, reason: resolved.reason };
  }

  const { spaceId } = resolved;
  const selectedPick = await prisma.drDailyPickArticle.findFirst({
    where: { spaceId, enabled: true },
  });

  if (!selectedPick) {
    return { date: getTodayIsoDate(), article: null, reason: "暂无精选文章" };
  }

  const article = await prisma.drArticle.findUnique({ where: { articleId: selectedPick.articleId } });
  if (!article) {
    return { date: getTodayIsoDate(), article: null, reason: "文章不存在" };
  }

  const [channel, rawHighlights] = await Promise.all([
    prisma.drChannel.findUnique({
      where: { channelId: article.channelId },
      select: { channelId: true, name: true },
    }),
    prisma.drEditorHighlight.findMany({
      where: { articleId: article.articleId },
      orderBy: { sortOrder: "asc" },
      select: { highlightId: true, text: true, color: true, note: true, sortOrder: true, contextBefore: true, contextAfter: true },
    }),
  ]);

  return {
    date: getTodayIsoDate(),
    article: {
      articleId: article.articleId,
      title: article.title,
      summary: article.summary,
      coverUrl: article.coverUrl,
      author: article.author,
      readTimeMinutes: Math.max(1, Math.ceil(article.content.length / 500)),
      channelId: article.channelId,
      channelName: channel?.name ?? "",
      highlights: rawHighlights,
    },
    reason: selectedPick.reason || "",
  };
}

export async function getThinkingLattice(userId: number, requestedSpaceId?: string) {
  const resolved = await resolvePreferredSpaceId(userId, requestedSpaceId);
  if (!resolved.ok) {
    return null;
  }

  const lattice = await fetchLatticeData(resolved.spaceId);
  if (!lattice) {
    return null;
  }

  const weekStart = getCurrentWeekStart();
  return {
    weekLabel: formatWeekLabel(weekStart),
    weekStart: weekStart.toISOString().split("T")[0],
    lattice,
  };
}

async function fetchLatticeDataById(latticeId: string) {
  const lattice = await prisma.drDailyPickLattice.findUnique({ where: { latticeId } });
  if (!lattice) return null;

  const collection = await prisma.drSpaceCollection.findUnique({ where: { collectionId: lattice.collectionId } });
  if (!collection) return null;

  const collectionArticles = await prisma.drSpaceCollectionArticle.findMany({
    where: { collectionId: lattice.collectionId },
    orderBy: { sortOrder: "asc" },
  });

  const articleIds = collectionArticles.map((ca) => ca.articleId);
  const articles =
    articleIds.length > 0 ? await prisma.drArticle.findMany({ where: { articleId: { in: articleIds } } }) : [];
  const articleMap = new Map(articles.map((a) => [a.articleId, a]));
  const nodeNames = parseNodeNames(lattice.nodeNames);
  const fallbackNodeNames = buildDefaultNodeNames(
    collectionArticles
      .filter((ca) => articleMap.has(ca.articleId))
      .map((ca) => articleMap.get(ca.articleId)?.title || ca.articleId)
  );

  return {
    latticeId: lattice.latticeId,
    enabled: lattice.enabled,
    createdAt: lattice.createdAt,
    collectionId: collection.collectionId,
    collectionName: collection.name,
    description: collection.description,
    coverUrl: collection.coverUrl,
    weeklyTopic: lattice.weeklyTopic ?? "",
    recommendation: lattice.recommendation,
    articles: collectionArticles
      .filter((ca) => articleMap.has(ca.articleId))
      .map((ca, index) => {
        const a = articleMap.get(ca.articleId)!;
        return {
          articleId: a.articleId,
          title: a.title,
          nodeName: nodeNames[index] || fallbackNodeNames[index] || buildDefaultNodeName(a.title),
          excerpt: a.summary,
          coverUrl: a.coverUrl,
          author: a.author,
          sortOrder: ca.sortOrder,
        };
      }),
  };
}

export async function getThinkingLatticeHistory(
  userId: number,
  requestedSpaceId: string | undefined,
  page: number,
  pageSize: number
) {
  const resolved = await resolvePreferredSpaceId(userId, requestedSpaceId);
  if (!resolved.ok) {
    return { list: [], total: 0, page, pageSize, reason: resolved.reason };
  }

  const { spaceId } = resolved;
  const where = { spaceId };
  const [total, lattices] = await Promise.all([
    prisma.drDailyPickLattice.count({ where }),
    prisma.drDailyPickLattice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const list = await Promise.all(
    lattices.map(async (l) => {
      const collection = await prisma.drSpaceCollection.findUnique({
        where: { collectionId: l.collectionId },
        select: { collectionId: true, name: true, description: true, coverUrl: true },
      });

      const collectionArticles = await prisma.drSpaceCollectionArticle.findMany({
        where: { collectionId: l.collectionId },
        orderBy: { sortOrder: "asc" },
      });

      const articleIds = collectionArticles.map((ca) => ca.articleId);
      const articles =
        articleIds.length > 0
          ? await prisma.drArticle.findMany({
              where: { articleId: { in: articleIds } },
              select: {
                articleId: true,
                title: true,
                summary: true,
                coverUrl: true,
                author: true,
              },
            })
          : [];
      const articleMap = new Map(articles.map((a) => [a.articleId, a]));
      const nodeNames = parseNodeNames(l.nodeNames);
      const fallbackNodeNames = buildDefaultNodeNames(
        collectionArticles
          .filter((ca) => articleMap.has(ca.articleId))
          .map((ca) => articleMap.get(ca.articleId)?.title || ca.articleId)
      );

      return {
        latticeId: l.latticeId,
        enabled: l.enabled,
        weeklyTopic: l.weeklyTopic ?? "",
        recommendation: l.recommendation,
        createdAt: l.createdAt,
        collection: collection
          ? {
              collectionId: collection.collectionId,
              name: collection.name,
              description: collection.description,
              coverUrl: collection.coverUrl,
            }
          : null,
        articles: collectionArticles
          .filter((ca) => articleMap.has(ca.articleId))
          .map((ca, index) => {
            const a = articleMap.get(ca.articleId)!;
            return {
              articleId: a.articleId,
              title: a.title,
              nodeName: nodeNames[index] || fallbackNodeNames[index] || buildDefaultNodeName(a.title),
              excerpt: a.summary,
              coverUrl: a.coverUrl,
              author: a.author,
              sortOrder: ca.sortOrder,
            };
          }),
      };
    })
  );

  return { list, total, page, pageSize };
}

async function fetchLatticeData(spaceId: string) {
  const lattice = await prisma.drDailyPickLattice.findFirst({ where: { spaceId, enabled: true } });
  if (!lattice) return null;

  const collection = await prisma.drSpaceCollection.findUnique({ where: { collectionId: lattice.collectionId } });
  if (!collection) return null;

  const collectionArticles = await prisma.drSpaceCollectionArticle.findMany({
    where: { collectionId: lattice.collectionId },
    orderBy: { sortOrder: "asc" },
  });

  const articleIds = collectionArticles.map((ca) => ca.articleId);
  const articles =
    articleIds.length > 0 ? await prisma.drArticle.findMany({ where: { articleId: { in: articleIds } } }) : [];
  const articleMap = new Map(articles.map((a) => [a.articleId, a]));
  const nodeNames = parseNodeNames(lattice.nodeNames);
  const fallbackNodeNames = buildDefaultNodeNames(
    collectionArticles
      .filter((ca) => articleMap.has(ca.articleId))
      .map((ca) => articleMap.get(ca.articleId)?.title || ca.articleId)
  );

  return {
    latticeId: lattice.latticeId,
    collectionId: collection.collectionId,
    collectionName: collection.name,
    description: collection.description,
    coverUrl: collection.coverUrl,
    weeklyTopic: lattice.weeklyTopic ?? "",
    recommendation: lattice.recommendation,
    articles: collectionArticles
      .filter((ca) => articleMap.has(ca.articleId))
      .map((ca, index) => {
        const a = articleMap.get(ca.articleId)!;
        return {
          articleId: a.articleId,
          title: a.title,
          nodeName: nodeNames[index] || fallbackNodeNames[index] || buildDefaultNodeName(a.title),
          excerpt: a.summary,
          coverUrl: a.coverUrl,
          author: a.author,
          sortOrder: ca.sortOrder,
        };
      }),
  };
}
