import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { signMiddleware } from "../middleware/sign";
import { drAuthMiddleware, DrAuthRequest, signDrToken } from "../middleware/drAuth";
import { chatWithArticle } from "../services/ai";

const router = Router();
const prisma = new PrismaClient();

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

// All routes use sign middleware
router.use(signMiddleware);

// ── Auth (no drAuth needed) ──────────────────────────────

// 2.1 Send SMS code
router.post("/sms/send", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { phone } = req.body as { phone?: string };

    if (!phone || !/^1\d{10}$/.test(phone)) {
      res.status(400).json({ code: 400, message: "手机号格式不正确" });
      return;
    }

    // Dev mode: fixed code 888888
    const code = "888888";
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.drSmsCode.create({
      data: { phone, code, expiresAt },
    });

    res.json({
      code: 200,
      message: "验证码已发送",
      data: { code }, // Dev only: return code directly
    });
  } catch (error) {
    console.error("SMS send error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 2.2 Login with SMS code
router.post("/login", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, code } = req.body as { phone?: string; code?: string };

    if (!phone || !/^1\d{10}$/.test(phone)) {
      res.status(400).json({ code: 400, message: "手机号格式不正确" });
      return;
    }
    if (!code) {
      res.status(400).json({ code: 400, message: "验证码不能为空" });
      return;
    }

    const smsRecord = await prisma.drSmsCode.findFirst({
      where: {
        phone,
        code,
        used: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!smsRecord) {
      res.status(400).json({ code: 400, message: "验证码错误或已过期" });
      return;
    }

    await prisma.drSmsCode.update({
      where: { id: smsRecord.id },
      data: { used: true },
    });

    // Find or create user
    let user = await prisma.drUser.findUnique({ where: { phone } });
    if (!user) {
      user = await prisma.drUser.create({
        data: { phone, nickname: `用户${phone.slice(-4)}` },
      });
    }

    const token = signDrToken({ userId: user.id, phone: user.phone });

    res.json({
      code: 200,
      message: "登录成功",
      data: {
        token,
        user: {
          id: user.id,
          phone: user.phone,
          nickname: user.nickname,
          avatar: user.avatar,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── All routes below require drAuth ──────────────────────
router.use(drAuthMiddleware);

// 2.3 Join space by invite code
router.post("/space/join", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { invite_code } = req.body as { invite_code?: string };
    if (!invite_code) {
      res.status(400).json({ code: 400, message: "邀请码不能为空" });
      return;
    }

    // Look up dynamic invite code
    const inviteCode = await prisma.drInviteCode.findUnique({
      where: { code: invite_code },
    });

    if (!inviteCode || inviteCode.disabled) {
      res.status(404).json({ code: 404, message: "邀请码无效" });
      return;
    }

    // Check expiry
    if (inviteCode.expiresAt && inviteCode.expiresAt < new Date()) {
      res.status(400).json({ code: 400, message: "邀请码已过期" });
      return;
    }

    // Check max uses
    if (inviteCode.maxUses !== null && inviteCode.useCount >= inviteCode.maxUses) {
      res.status(400).json({ code: 400, message: "邀请码使用次数已达上限" });
      return;
    }

    const space = await prisma.drSpace.findUnique({
      where: { spaceId: inviteCode.spaceId },
    });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    // Check if already a member
    const existing = await prisma.drSpaceMember.findUnique({
      where: { spaceId_userId: { spaceId: space.spaceId, userId: req.drUserId! } },
    });

    if (!existing) {
      // Create membership and increment use count atomically
      await prisma.$transaction([
        prisma.drSpaceMember.create({
          data: {
            spaceId: space.spaceId,
            userId: req.drUserId!,
            role: "member",
            inviteCodeId: inviteCode.codeId,
          },
        }),
        prisma.drInviteCode.update({
          where: { codeId: inviteCode.codeId },
          data: { useCount: { increment: 1 } },
        }),
      ]);
    }

    res.json({
      code: 200,
      message: existing ? "您已是该空间成员" : "加入成功",
      data: {
        spaceId: space.spaceId,
        name: space.name,
        description: space.description,
      },
    });
  } catch (error) {
    console.error("Join space error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 3.1 Get articles list
router.get("/articles", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.query.space_id as string;
    const channelId = req.query.channel_id as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 20;

    if (!spaceId) {
      res.status(400).json({ code: 400, message: "space_id 不能为空" });
      return;
    }

    // Check membership
    const member = await prisma.drSpaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId: req.drUserId! } },
    });
    if (!member) {
      res.status(403).json({ code: 403, message: "您不是该空间的成员" });
      return;
    }

    const where: Record<string, unknown> = { spaceId };
    if (channelId) where.channelId = channelId;

    const [articles, total] = await Promise.all([
      prisma.drArticle.findMany({
        where,
        select: {
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
        },
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.drArticle.count({ where }),
    ]);

    // Batch get bookmark & read status
    const articleIds = articles.map((a) => a.articleId);
    const [bookmarks, readStatuses] = await Promise.all([
      prisma.drBookmark.findMany({
        where: { userId: req.drUserId!, articleId: { in: articleIds } },
      }),
      prisma.drReadStatus.findMany({
        where: { userId: req.drUserId!, articleId: { in: articleIds } },
      }),
    ]);

    const bookmarkSet = new Set(bookmarks.map((b) => b.articleId));
    const readMap = new Map(readStatuses.map((r) => [r.articleId, r.progress]));

    res.json({
      code: 200,
      message: "success",
      data: {
        list: articles.map((a) => ({
          ...a,
          bookmarked: bookmarkSet.has(a.articleId),
          readProgress: readMap.get(a.articleId) ?? 0,
        })),
        total,
        page,
        pageSize,
      },
    });
  } catch (error) {
    console.error("Get articles error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 3.2 Get article detail
router.get("/articles/:articleId", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.params.articleId as string;

    const article = await prisma.drArticle.findUnique({
      where: { articleId },
    });
    if (!article) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    // Check membership
    const member = await prisma.drSpaceMember.findUnique({
      where: { spaceId_userId: { spaceId: article.spaceId, userId: req.drUserId! } },
    });
    if (!member) {
      res.status(403).json({ code: 403, message: "您不是该空间的成员" });
      return;
    }

    // Increment read count
    await prisma.drArticle.update({
      where: { articleId },
      data: { readCount: { increment: 1 } },
    });

    const [bookmark, readStatus] = await Promise.all([
      prisma.drBookmark.findUnique({
        where: { userId_articleId: { userId: req.drUserId!, articleId } },
      }),
      prisma.drReadStatus.findUnique({
        where: { userId_articleId: { userId: req.drUserId!, articleId } },
      }),
    ]);

    res.json({
      code: 200,
      message: "success",
      data: {
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
      },
    });
  } catch (error) {
    console.error("Get article detail error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 3.3 Bookmark / unbookmark
router.put("/articles/:articleId/bookmark", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.params.articleId as string;
    const { bookmarked } = req.body as { bookmarked?: boolean };

    if (bookmarked) {
      await prisma.drBookmark.upsert({
        where: { userId_articleId: { userId: req.drUserId!, articleId } },
        update: {},
        create: { userId: req.drUserId!, articleId },
      });
    } else {
      await prisma.drBookmark.deleteMany({
        where: { userId: req.drUserId!, articleId },
      });
    }

    res.json({ code: 200, message: bookmarked ? "已收藏" : "已取消收藏" });
  } catch (error) {
    console.error("Bookmark error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 3.4 Mark as read
router.put("/articles/:articleId/read", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.params.articleId as string;
    const { progress } = req.body as { progress?: number };

    await prisma.drReadStatus.upsert({
      where: { userId_articleId: { userId: req.drUserId!, articleId } },
      update: { progress: progress ?? 100, readAt: new Date() },
      create: { userId: req.drUserId!, articleId, progress: progress ?? 100 },
    });

    res.json({ code: 200, message: "已标记" });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── Highlights (Phase 4) ─────────────────────────────────

// 4.1 Create highlight
router.post("/highlights", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { article_id, text, color, position_data, note } = req.body as {
      article_id?: string;
      text?: string;
      color?: string;
      position_data?: unknown;
      note?: string;
    };

    if (!article_id || !text) {
      res.status(400).json({ code: 400, message: "article_id 和 text 不能为空" });
      return;
    }

    const highlight = await prisma.drHighlight.create({
      data: {
        highlightId: generateId("H"),
        userId: req.drUserId!,
        articleId: article_id,
        text,
        color: color || "#FFEB3B",
        positionData: position_data ? JSON.stringify(position_data) : "{}",
        note: note || "",
      },
    });

    res.json({
      code: 200,
      message: "批注已创建",
      data: {
        highlightId: highlight.highlightId,
        articleId: highlight.articleId,
        text: highlight.text,
        color: highlight.color,
        positionData: JSON.parse(highlight.positionData),
        note: highlight.note,
        createdAt: highlight.createdAt,
      },
    });
  } catch (error) {
    console.error("Create highlight error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 4.2 Update highlight
router.put("/highlights/:highlightId", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const highlightId = req.params.highlightId as string;
    const { color, note } = req.body as { color?: string; note?: string };

    const existing = await prisma.drHighlight.findUnique({ where: { highlightId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "批注不存在" });
      return;
    }
    if (existing.userId !== req.drUserId) {
      res.status(403).json({ code: 403, message: "无权修改他人的批注" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (color !== undefined) updateData.color = color;
    if (note !== undefined) updateData.note = note;

    const updated = await prisma.drHighlight.update({
      where: { highlightId },
      data: updateData,
    });

    res.json({
      code: 200,
      message: "批注已更新",
      data: {
        highlightId: updated.highlightId,
        color: updated.color,
        note: updated.note,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update highlight error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 4.3 Delete highlight
router.delete("/highlights/:highlightId", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const highlightId = req.params.highlightId as string;

    const existing = await prisma.drHighlight.findUnique({ where: { highlightId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "批注不存在" });
      return;
    }
    if (existing.userId !== req.drUserId) {
      res.status(403).json({ code: 403, message: "无权删除他人的批注" });
      return;
    }

    await prisma.drHighlight.delete({ where: { highlightId } });

    res.json({ code: 200, message: "批注已删除" });
  } catch (error) {
    console.error("Delete highlight error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 4.4 Get highlights for article
router.get("/highlights", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.query.article_id as string;
    if (!articleId) {
      res.status(400).json({ code: 400, message: "article_id 不能为空" });
      return;
    }

    const highlights = await prisma.drHighlight.findMany({
      where: { userId: req.drUserId!, articleId },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      code: 200,
      message: "success",
      data: highlights.map((h) => ({
        highlightId: h.highlightId,
        articleId: h.articleId,
        text: h.text,
        color: h.color,
        positionData: JSON.parse(h.positionData),
        note: h.note,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Get highlights error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── Collections (Phase 5) ────────────────────────────────

// 5.1 Create collection
router.post("/collections", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ code: 400, message: "合集名称不能为空" });
      return;
    }

    const collection = await prisma.drCollection.create({
      data: {
        collectionId: generateId("C"),
        userId: req.drUserId!,
        name: name.trim(),
      },
    });

    res.json({
      code: 200,
      message: "合集已创建",
      data: {
        collectionId: collection.collectionId,
        name: collection.name,
        createdAt: collection.createdAt,
      },
    });
  } catch (error) {
    console.error("Create collection error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 5.2 Add/remove article from collection
router.put("/collections/:collectionId/articles", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const collectionId = req.params.collectionId as string;
    const { article_id, action } = req.body as { article_id?: string; action?: "add" | "remove" };

    if (!article_id || !action) {
      res.status(400).json({ code: 400, message: "article_id 和 action 不能为空" });
      return;
    }

    const collection = await prisma.drCollection.findUnique({ where: { collectionId } });
    if (!collection) {
      res.status(404).json({ code: 404, message: "合集不存在" });
      return;
    }
    if (collection.userId !== req.drUserId) {
      res.status(403).json({ code: 403, message: "无权操作他人的合集" });
      return;
    }

    if (action === "add") {
      await prisma.drCollectionArticle.upsert({
        where: { collectionId_articleId: { collectionId, articleId: article_id } },
        update: {},
        create: { collectionId, articleId: article_id },
      });
      res.json({ code: 200, message: "已添加到合集" });
    } else {
      await prisma.drCollectionArticle.deleteMany({
        where: { collectionId, articleId: article_id },
      });
      res.json({ code: 200, message: "已从合集移除" });
    }
  } catch (error) {
    console.error("Collection article error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 5.3 Get collections list
router.get("/collections", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const collections = await prisma.drCollection.findMany({
      where: { userId: req.drUserId! },
      orderBy: { createdAt: "desc" },
    });

    const collectionIds = collections.map((c) => c.collectionId);
    const counts = await prisma.drCollectionArticle.groupBy({
      by: ["collectionId"],
      where: { collectionId: { in: collectionIds } },
      _count: { articleId: true },
    });
    const countMap = new Map(counts.map((c) => [c.collectionId, c._count.articleId]));

    res.json({
      code: 200,
      message: "success",
      data: collections.map((c) => ({
        collectionId: c.collectionId,
        name: c.name,
        articleCount: countMap.get(c.collectionId) ?? 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Get collections error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── AI Chat (Phase 6) ────────────────────────────────────

router.post("/ai/chat", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { article_id, message: userMessage } = req.body as {
      article_id?: string;
      message?: string;
    };

    if (!article_id || !userMessage) {
      res.status(400).json({ code: 400, message: "article_id 和 message 不能为空" });
      return;
    }

    const article = await prisma.drArticle.findUnique({
      where: { articleId: article_id },
    });
    if (!article) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    // Strip HTML tags to get plain text
    const plainText = article.content.replace(/<[^>]*>/g, "").replace(/[#*`]/g, "").trim();

    const reply = await chatWithArticle(article.title, plainText, userMessage);

    res.json({
      code: 200,
      message: "success",
      data: { reply: reply || "抱歉，无法生成回复" },
    });
  } catch (error) {
    console.error("AI chat error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

export default router;
