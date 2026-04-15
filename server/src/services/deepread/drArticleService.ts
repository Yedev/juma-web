import prisma from "../../lib/prisma";

const ARTICLE_LIST_SELECT = {
  articleId: true,
  spaceId: true,
  channelId: true,
  title: true,
  summary: true,
  coverUrl: true,
  layoutType: true,
  author: true,
  readCount: true,
  publishedAt: true,
} as const;

type ArticleListItem = {
  articleId: string;
  spaceId: string;
  channelId: string;
  title: string;
  summary: string;
  coverUrl: string;
  layoutType: string;
  author: string;
  readCount: number;
  publishedAt: Date;
};

export async function getArticlesList(
  userId: number,
  spaceId: string,
  options: { channelId?: string; collectionId?: string; page: number; pageSize: number },
) {
  const { channelId, collectionId, page, pageSize } = options;
  let articles: ArticleListItem[];
  let total: number;

  if (collectionId) {
    const collection = await prisma.drSpaceCollection.findUnique({ where: { collectionId } });
    if (!collection || collection.spaceId !== spaceId) return null;

    const [items, count] = await Promise.all([
      prisma.drSpaceCollectionArticle.findMany({
        where: { collectionId },
        orderBy: { sortOrder: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.drSpaceCollectionArticle.count({ where: { collectionId } }),
    ]);

    total = count;
    const articleIds = items.map((i) => i.articleId);
    articles =
      articleIds.length > 0
        ? await prisma.drArticle
            .findMany({ where: { articleId: { in: articleIds } }, select: ARTICLE_LIST_SELECT })
            .then((rows) => {
              const map = new Map(rows.map((r) => [r.articleId, r]));
              return items.map((i) => map.get(i.articleId)!).filter(Boolean);
            })
        : [];
  } else {
    const where: Record<string, unknown> = { spaceId };
    if (channelId) where.channelId = channelId;

    [articles, total] = await Promise.all([
      prisma.drArticle.findMany({
        where,
        select: ARTICLE_LIST_SELECT,
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.drArticle.count({ where }),
    ]);
  }

  const enriched = await enrichWithUserState(userId, articles);
  return { list: enriched, total, page, pageSize };
}

export async function getArticleDetail(userId: number, articleId: string) {
  const article = await prisma.drArticle.findUnique({ where: { articleId } });
  if (!article) return null;

  await prisma.drArticle.update({
    where: { articleId },
    data: { readCount: { increment: 1 } },
  });

  const [bookmark, readStatus] = await Promise.all([
    prisma.drBookmark.findUnique({ where: { userId_articleId: { userId, articleId } } }),
    prisma.drReadStatus.findUnique({ where: { userId_articleId: { userId, articleId } } }),
  ]);

  return {
    articleId: article.articleId,
    spaceId: article.spaceId,
    channelId: article.channelId,
    title: article.title,
    summary: article.summary,
    coverUrl: article.coverUrl,
    layoutType: article.layoutType,
    content: article.content,
    contentType: article.contentType,
    author: article.author,
    readCount: article.readCount + 1,
    publishedAt: article.publishedAt,
    bookmarked: !!bookmark,
    readProgress: readStatus?.progress ?? 0,
  };
}

export async function setBookmark(userId: number, articleId: string, bookmarked: boolean) {
  if (bookmarked) {
    await prisma.drBookmark.upsert({
      where: { userId_articleId: { userId, articleId } },
      update: {},
      create: { userId, articleId },
    });
  } else {
    await prisma.drBookmark.deleteMany({ where: { userId, articleId } });
  }
}

export async function setReadProgress(userId: number, articleId: string, progress: number) {
  await prisma.drReadStatus.upsert({
    where: { userId_articleId: { userId, articleId } },
    update: { progress, readAt: new Date() },
    create: { userId, articleId, progress },
  });
}

// Shared helper: enrich articles with bookmark/read status
export async function enrichWithUserState(
  userId: number,
  articles: Array<{ articleId: string; [key: string]: unknown }>,
) {
  if (articles.length === 0) return [];
  const articleIds = articles.map((a) => a.articleId);
  const [bookmarks, readStatuses] = await Promise.all([
    prisma.drBookmark.findMany({ where: { userId, articleId: { in: articleIds } } }),
    prisma.drReadStatus.findMany({ where: { userId, articleId: { in: articleIds } } }),
  ]);
  const bookmarkSet = new Set(bookmarks.map((b) => b.articleId));
  const readMap = new Map(readStatuses.map((r) => [r.articleId, r.progress]));

  return articles.map((a) => ({
    ...a,
    bookmarked: bookmarkSet.has(a.articleId),
    readProgress: readMap.get(a.articleId) ?? 0,
  }));
}
