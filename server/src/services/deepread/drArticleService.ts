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
  highlights: true,
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
  highlights: string;
  readCount: number;
  publishedAt: Date;
};

export async function getArticlesList(
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

  const list = articles.map((a) => ({ ...a, highlights: JSON.parse(a.highlights || "[]") }));
  return { list, total, page, pageSize };
}

export async function getArticleDetail(articleId: string) {
  const article = await prisma.drArticle.findUnique({ where: { articleId } });
  if (!article) return null;

  await prisma.drArticle.update({
    where: { articleId },
    data: { readCount: { increment: 1 } },
  });

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
    highlights: JSON.parse(article.highlights || "[]"),
    readCount: article.readCount + 1,
    publishedAt: article.publishedAt,
  };
}

