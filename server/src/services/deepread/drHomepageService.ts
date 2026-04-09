import prisma from "../../lib/prisma";
import { enrichWithUserState } from "./drArticleService";

export async function getHomepageModules(userId: number, spaceId: string) {
  const modules = await prisma.drSpaceHomepageModule.findMany({
    where: { spaceId },
    orderBy: { sortOrder: "asc" },
  });

  if (modules.length === 0) return [];

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

  const enrichedArticles = await enrichWithUserState(userId, articles);

  const channelMap = new Map(channels.map((c) => [c.channelId, c]));
  const articleMap = new Map(enrichedArticles.map((a) => [a.articleId, a]));
  const collectionMap = new Map(collectionsData.map((c) => [c.collectionId, c]));

  const resourcesByModule = new Map<string, unknown[]>();
  for (const r of resources) {
    if (!resourcesByModule.has(r.moduleId)) resourcesByModule.set(r.moduleId, []);
    let detail: unknown = null;
    if (r.resourceType === "channel") {
      detail = channelMap.get(r.resourceId) ?? null;
    } else if (r.resourceType === "article") {
      detail = articleMap.get(r.resourceId) ?? null;
    } else if (r.resourceType === "collection") {
      detail = collectionMap.get(r.resourceId) ?? null;
    }
    resourcesByModule.get(r.moduleId)!.push({
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      sortOrder: r.sortOrder,
      detail,
    });
  }

  return orderedModules.map((m) => {
    const base = { moduleId: m.moduleId, moduleType: m.moduleType || "standard", title: m.title };
    if (m.moduleType === "title_desc") {
      return { ...base, description: m.description };
    }
    if (m.moduleType === "load_list") {
      return { ...base, subtitle: m.subtitle, sourceType: m.sourceType, sourceId: m.sourceId };
    }
    return { ...base, subtitle: m.subtitle, layoutType: m.layoutType, resources: resourcesByModule.get(m.moduleId) ?? [] };
  });
}

export async function getDailyArticle(userId: number) {
  const memberships = await prisma.drSpaceMember.findMany({ where: { userId } });

  if (memberships.length === 0) {
    return { date: new Date().toISOString().split("T")[0], article: null, reason: "您还没有加入任何空间" };
  }

  const spaceId = memberships[0].spaceId;

  const selectedPick = await prisma.drDailyPickArticle.findFirst({
    where: { spaceId, enabled: true },
  });

  if (!selectedPick) {
    return { date: new Date().toISOString().split("T")[0], article: null, reason: "暂无精选文章" };
  }

  const article = await prisma.drArticle.findUnique({ where: { articleId: selectedPick.articleId } });
  if (!article) {
    return { date: new Date().toISOString().split("T")[0], article: null, reason: "文章不存在" };
  }

  const [channel, rawHighlights, lattice] = await Promise.all([
    prisma.drChannel.findUnique({
      where: { channelId: article.channelId },
      select: { channelId: true, name: true },
    }),
    prisma.drEditorHighlight.findMany({
      where: { articleId: article.articleId },
      orderBy: { sortOrder: "asc" },
      select: { highlightId: true, text: true, color: true, note: true, sortOrder: true, contextBefore: true, contextAfter: true },
    }),
    fetchLatticeData(spaceId),
  ]);

  return {
    date: new Date().toISOString().split("T")[0],
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
    lattice,
  };
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

  return {
    collectionId: collection.collectionId,
    collectionName: collection.name,
    description: collection.description,
    coverUrl: collection.coverUrl,
    recommendation: lattice.recommendation,
    articles: collectionArticles
      .filter((ca) => articleMap.has(ca.articleId))
      .map((ca) => {
        const a = articleMap.get(ca.articleId)!;
        return {
          articleId: a.articleId,
          title: a.title,
          summary: a.summary,
          coverUrl: a.coverUrl,
          author: a.author,
          publishedAt: a.publishedAt,
        };
      }),
  };
}
