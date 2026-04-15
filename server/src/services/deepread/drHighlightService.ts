import prisma from "../../lib/prisma";
import { generateId } from "../../lib/generateId";

export async function createHighlight(
  userId: number,
  articleId: string,
  text: string,
  color?: string,
  positionData?: unknown,
  note?: string,
) {
  return prisma.drHighlight.create({
    data: {
      highlightId: generateId("H"),
      userId,
      articleId,
      text,
      color: color || "#FFEB3B",
      positionData: positionData ? JSON.stringify(positionData) : "{}",
      note: note || "",
    },
  });
}

export async function getHighlights(userId: number, articleId: string) {
  const highlights = await prisma.drHighlight.findMany({
    where: { userId, articleId },
    orderBy: { createdAt: "asc" },
  });

  return highlights.map((h) => ({
    highlightId: h.highlightId,
    articleId: h.articleId,
    text: h.text,
    color: h.color,
    positionData: JSON.parse(h.positionData),
    note: h.note,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  }));
}
