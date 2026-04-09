import prisma from "../../lib/prisma";
import { generateId } from "../../lib/generateId";

export async function createCollection(userId: number, name: string) {
  return prisma.drCollection.create({
    data: { collectionId: generateId("C"), userId, name: name.trim() },
  });
}

type ServiceError = { error: string; status: number };

export async function modifyCollectionArticle(
  userId: number,
  collectionId: string,
  articleId: string,
  action: "add" | "remove",
): Promise<ServiceError | { success: true }> {
  const collection = await prisma.drCollection.findUnique({ where: { collectionId } });
  if (!collection) return { error: "合集不存在", status: 404 };
  if (collection.userId !== userId) return { error: "无权操作他人的合集", status: 403 };

  if (action === "add") {
    await prisma.drCollectionArticle.upsert({
      where: { collectionId_articleId: { collectionId, articleId } },
      update: {},
      create: { collectionId, articleId },
    });
  } else {
    await prisma.drCollectionArticle.deleteMany({ where: { collectionId, articleId } });
  }
  return { success: true };
}

export async function getCollections(userId: number) {
  const collections = await prisma.drCollection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const collectionIds = collections.map((c) => c.collectionId);
  const counts = await prisma.drCollectionArticle.groupBy({
    by: ["collectionId"],
    where: { collectionId: { in: collectionIds } },
    _count: { articleId: true },
  });
  const countMap = new Map(counts.map((c) => [c.collectionId, c._count.articleId]));

  return collections.map((c) => ({
    collectionId: c.collectionId,
    name: c.name,
    articleCount: countMap.get(c.collectionId) ?? 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}
