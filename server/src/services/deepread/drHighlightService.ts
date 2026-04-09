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

type ServiceError = { error: string; status: number };

export async function updateHighlight(userId: number, highlightId: string, data: { color?: string; note?: string }): Promise<ServiceError | { data: Awaited<ReturnType<typeof prisma.drHighlight.update>> }> {
  const existing = await prisma.drHighlight.findUnique({ where: { highlightId } });
  if (!existing) return { error: "批注不存在", status: 404 };
  if (existing.userId !== userId) return { error: "无权修改他人的批注", status: 403 };

  const updateData: Record<string, unknown> = {};
  if (data.color !== undefined) updateData.color = data.color;
  if (data.note !== undefined) updateData.note = data.note;

  const updated = await prisma.drHighlight.update({ where: { highlightId }, data: updateData });
  return { data: updated };
}

export async function deleteHighlight(userId: number, highlightId: string): Promise<ServiceError | { success: true }> {
  const existing = await prisma.drHighlight.findUnique({ where: { highlightId } });
  if (!existing) return { error: "批注不存在", status: 404 };
  if (existing.userId !== userId) return { error: "无权删除他人的批注", status: 403 };

  await prisma.drHighlight.delete({ where: { highlightId } });
  return { success: true };
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
