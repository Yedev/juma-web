import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { signMiddleware } from "../middleware/sign";
import { drAuthMiddleware, DrAuthRequest, signDrToken } from "../middleware/drAuth";

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
    const collectionId = req.query.collection_id as string | undefined;
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

    let articles: {
      articleId: string;
      spaceId: string;
      channelId: string;
      title: string;
      summary: string | null;
      coverUrl: string | null;
      layoutType: string;
      author: string | null;
      readCount: number;
      publishedAt: Date;
    }[];
    let total: number;

    if (collectionId) {
      // Verify collection belongs to the space
      const collection = await prisma.drSpaceCollection.findUnique({ where: { collectionId } });
      if (!collection || collection.spaceId !== spaceId) {
        res.status(404).json({ code: 404, message: "合集不存在" });
        return;
      }

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
          ? await prisma.drArticle.findMany({
              where: { articleId: { in: articleIds } },
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
            }).then((rows) => {
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
    }

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

// 5.4 Get space collection articles
// ── Space Homepage ───────────────────────────────────────

// Get space homepage modules with resources
router.get("/spaces/:spaceId/homepage", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;

    // Check membership
    const member = await prisma.drSpaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId: req.drUserId! } },
    });
    if (!member) {
      res.status(403).json({ code: 403, message: "您不是该空间的成员" });
      return;
    }

    const modules = await prisma.drSpaceHomepageModule.findMany({
      where: { spaceId },
      orderBy: { sortOrder: "asc" },
    });

    if (modules.length === 0) {
      res.json({ code: 200, message: "success", data: [] });
      return;
    }

    // load_list modules always appear last
    const nonLoadListModules = modules.filter((m) => m.moduleType !== "load_list");
    const loadListModules = modules.filter((m) => m.moduleType === "load_list");
    const orderedModules = [...nonLoadListModules, ...loadListModules];

    // ── Fetch resources for standard modules only ──
    const standardModuleIds = nonLoadListModules
      .filter((m) => m.moduleType === "standard" || !m.moduleType)
      .map((m) => m.moduleId);
    const resources = standardModuleIds.length > 0
      ? await prisma.drSpaceHomepageModuleResource.findMany({
          where: { moduleId: { in: standardModuleIds } },
          orderBy: { sortOrder: "asc" },
        })
      : [];

    const channelIds = resources.filter((r) => r.resourceType === "channel").map((r) => r.resourceId);
    const articleIds = resources.filter((r) => r.resourceType === "article").map((r) => r.resourceId);
    const collectionIds = resources.filter((r) => r.resourceType === "collection").map((r) => r.resourceId);

    const [channels, articles, collectionsData, bookmarks, readStatuses] = await Promise.all([
      channelIds.length > 0 ? prisma.drChannel.findMany({ where: { channelId: { in: channelIds } } }) : [],
      articleIds.length > 0
        ? prisma.drArticle.findMany({
            where: { articleId: { in: articleIds } },
            select: {
              articleId: true, channelId: true, title: true, summary: true,
              coverUrl: true, layoutType: true, author: true, readCount: true, publishedAt: true,
            },
          })
        : [],
      collectionIds.length > 0
        ? prisma.drSpaceCollection.findMany({ where: { collectionId: { in: collectionIds } } })
        : [],
      articleIds.length > 0
        ? prisma.drBookmark.findMany({ where: { userId: req.drUserId!, articleId: { in: articleIds } } })
        : [],
      articleIds.length > 0
        ? prisma.drReadStatus.findMany({ where: { userId: req.drUserId!, articleId: { in: articleIds } } })
        : [],
    ]);

    const channelMap = new Map(channels.map((c) => [c.channelId, c]));
    const articleMap = new Map(articles.map((a) => [a.articleId, a]));
    const collectionMap = new Map(collectionsData.map((c) => [c.collectionId, c]));
    const bookmarkSet = new Set(bookmarks.map((b) => b.articleId));
    const readMap = new Map(readStatuses.map((r) => [r.articleId, r.progress]));

    const resourcesByModule = new Map<string, unknown[]>();
    for (const r of resources) {
      if (!resourcesByModule.has(r.moduleId)) resourcesByModule.set(r.moduleId, []);
      let detail: unknown = null;
      if (r.resourceType === "channel") {
        detail = channelMap.get(r.resourceId) ?? null;
      } else if (r.resourceType === "article") {
        const a = articleMap.get(r.resourceId);
        if (a) detail = { ...a, bookmarked: bookmarkSet.has(a.articleId), readProgress: readMap.get(a.articleId) ?? 0 };
      } else if (r.resourceType === "collection") {
        detail = collectionMap.get(r.resourceId) ?? null;
      }
      resourcesByModule.get(r.moduleId)!.push({ resourceType: r.resourceType, resourceId: r.resourceId, sortOrder: r.sortOrder, detail });
    }

    res.json({
      code: 200,
      message: "success",
      data: orderedModules.map((m) => {
        const base = { moduleId: m.moduleId, moduleType: m.moduleType || "standard", title: m.title };
        if (m.moduleType === "title_desc") {
          return { ...base, description: m.description };
        }
        if (m.moduleType === "load_list") {
          return { ...base, subtitle: m.subtitle, sourceType: m.sourceType, sourceId: m.sourceId };
        }
        // standard
        return { ...base, subtitle: m.subtitle, layoutType: m.layoutType, resources: resourcesByModule.get(m.moduleId) ?? [] };
      }),
    });
  } catch (error) {
    console.error("Get homepage error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});


// ── 每日精选 (Phase 7) ────────────────────────────────────

// 获取思维格栅数据
async function fetchLatticeData(spaceId: string) {
  const lattice = await prisma.drDailyPickLattice.findUnique({ where: { spaceId } });
  if (!lattice || !lattice.enabled) return null;

  const collection = await prisma.drSpaceCollection.findUnique({ where: { collectionId: lattice.collectionId } });
  if (!collection) return null;

  const collectionArticles = await prisma.drSpaceCollectionArticle.findMany({
    where: { collectionId: lattice.collectionId },
    orderBy: { sortOrder: "asc" },
  });

  const articleIds = collectionArticles.map((ca) => ca.articleId);
  const articles = articleIds.length > 0
    ? await prisma.drArticle.findMany({ where: { articleId: { in: articleIds } } })
    : [];
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

// 简单字符串哈希函数
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ── 阅读统计 ───────────────────────────────────────────────────

// 生成唯一的 statsId
function generateStatsId(): string {
  return `RS${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;
}

// 上报阅读统计
// include_today_summary=true 时返回当日汇总（total_reading_time_today, articles_read_today）
router.post("/reading-stats", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const includeTodaySummary = req.query.include_today_summary === "true";
    const { article_id, reading_time_seconds, scroll_depth, session_start, session_end } = req.body as {
      article_id?: string;
      reading_time_seconds?: number;
      scroll_depth?: number;
      session_start?: string;
      session_end?: string;
    };

    if (!article_id) {
      res.status(400).json({ code: 400, message: "article_id 不能为空" });
      return;
    }

    // 验证文章存在
    const article = await prisma.drArticle.findUnique({ where: { articleId: article_id } });
    if (!article) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    const stats = await prisma.drReadingStats.create({
      data: {
        statsId: generateStatsId(),
        userId: req.drUserId!,
        articleId: article_id,
        readingTimeMs: (reading_time_seconds ?? 0) * 1000,
        scrollDepth: scroll_depth ?? 0,
        sessionStart: session_start ? new Date(session_start) : new Date(),
        sessionEnd: session_end ? new Date(session_end) : new Date(),
      },
    });

    const baseData = {
      statsId: stats.statsId,
      articleId: stats.articleId,
      readingTimeSeconds: Math.floor(stats.readingTimeMs / 1000),
      scrollDepth: stats.scrollDepth,
      createdAt: stats.createdAt,
    };

    // 按需返回当日汇总
    if (includeTodaySummary) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayStats = await prisma.drReadingStats.findMany({
        where: { userId: req.drUserId!, createdAt: { gte: todayStart } },
        select: { articleId: true, readingTimeMs: true },
      });

      const uniqueArticles = new Set(todayStats.map((s) => s.articleId));
      const totalReadingTimeMs = todayStats.reduce((sum, s) => sum + s.readingTimeMs, 0);

      res.json({
        code: 200,
        message: "统计已记录",
        data: {
          ...baseData,
          total_reading_time_today: Math.floor(totalReadingTimeMs / 1000),
          articles_read_today: uniqueArticles.size,
        },
      });
    } else {
      res.json({
        code: 200,
        message: "统计已上报",
        data: baseData,
      });
    }
  } catch (error) {
    console.error("Create reading stats error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 批量上报阅读统计（最多 100 条）
router.post("/reading-stats/batch", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { stats } = req.body as {
      stats?: Array<{
        article_id: string;
        reading_time_seconds: number;
        scroll_depth: number;
        session_start: string;
        session_end: string;
      }>;
    };

    if (!Array.isArray(stats) || stats.length === 0) {
      res.status(400).json({ code: 400, message: "stats 不能为空" });
      return;
    }

    if (stats.length > 100) {
      res.status(400).json({ code: 400, message: "单次最多上报 100 条统计" });
      return;
    }

    // 验证所有文章存在
    const articleIds = [...new Set(stats.map((s) => s.article_id))];
    const articles = await prisma.drArticle.findMany({
      where: { articleId: { in: articleIds } },
    });
    const validArticleIds = new Set(articles.map((a) => a.articleId));

    const createData = stats
      .filter((s) => validArticleIds.has(s.article_id))
      .map(() => ({
        statsId: generateStatsId(),
        userId: req.drUserId!,
        articleId: stats.find((s) => validArticleIds.has(s.article_id))!.article_id,
        readingTimeMs: 0,
        scrollDepth: 0,
        sessionStart: new Date(),
        sessionEnd: new Date(),
      }));

    // 重新构建正确的数据
    const validStats = stats.filter((s) => validArticleIds.has(s.article_id));
    const createDataFixed = validStats.map((s) => ({
      statsId: generateStatsId(),
      userId: req.drUserId!,
      articleId: s.article_id,
      readingTimeMs: (s.reading_time_seconds ?? 0) * 1000,
      scrollDepth: s.scroll_depth ?? 0,
      sessionStart: s.session_start ? new Date(s.session_start) : new Date(),
      sessionEnd: s.session_end ? new Date(s.session_end) : new Date(),
    }));

    if (createDataFixed.length === 0) {
      res.json({ code: 200, message: "无有效统计数据", data: { count: 0 } });
      return;
    }

    await prisma.drReadingStats.createMany({ data: createDataFixed });

    res.json({
      code: 200,
      message: "统计已批量上报",
      data: { count: createDataFixed.length },
    });
  } catch (error) {
    console.error("Batch create reading stats error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 获取用户阅读统计汇总
router.get("/stats/summary", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const period = (req.query.period as string) || "all";

    // 计算时间范围
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

    const whereClause = startDate ? { userId: req.drUserId!, createdAt: { gte: startDate } } : { userId: req.drUserId! };

    // 获取阅读统计
    const stats = await prisma.drReadingStats.findMany({
      where: whereClause,
      select: { articleId: true, readingTimeMs: true },
    });

    // 获取批注数
    const highlightCount = await prisma.drHighlight.count({
      where: { userId: req.drUserId! },
    });

    // 获取收藏数
    const bookmarkCount = await prisma.drBookmark.count({
      where: { userId: req.drUserId! },
    });

    // 计算连续阅读天数
    const allStats = await prisma.drReadingStats.findMany({
      where: { userId: req.drUserId! },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    let streakDays = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const checkDate = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const hasStats = allStats.some((s) => {
        const statDate = new Date(s.createdAt);
        return statDate.toDateString() === checkDate.toDateString();
      });
      if (hasStats) {
        streakDays++;
      } else if (i > 0) {
        break;
      }
    }

    // 统计文章数
    const uniqueArticles = new Set(stats.map((s) => s.articleId));
    const totalReadingTimeMs = stats.reduce((sum, s) => sum + s.readingTimeMs, 0);

    res.json({
      code: 200,
      message: "success",
      data: {
        total_reading_time_seconds: Math.floor(totalReadingTimeMs / 1000),
        total_articles_read: uniqueArticles.size,
        total_highlights: highlightCount,
        total_notes: highlightCount,
        reading_streak_days: streakDays,
      },
    });
  } catch (error) {
    console.error("Get stats summary error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── 收藏列表 ───────────────────────────────────────────────────

router.get("/bookmarks", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 20;

    const [bookmarks, total] = await Promise.all([
      prisma.drBookmark.findMany({
        where: { userId: req.drUserId! },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.drBookmark.count({ where: { userId: req.drUserId! } }),
    ]);

    // 获取文章详情
    const articleIds = bookmarks.map((b) => b.articleId);
    const articles = articleIds.length > 0
      ? await prisma.drArticle.findMany({
          where: { articleId: { in: articleIds } },
          select: { articleId: true, title: true, summary: true, coverUrl: true, author: true },
        })
      : [];
    const articleMap = new Map(articles.map((a) => [a.articleId, a]));

    res.json({
      code: 200,
      message: "success",
      data: {
        list: bookmarks
          .filter((b) => articleMap.has(b.articleId))
          .map((b) => {
            const article = articleMap.get(b.articleId)!;
            return {
              articleId: article.articleId,
              title: article.title,
              summary: article.summary,
              coverUrl: article.coverUrl,
              author: article.author,
              bookmarkedAt: b.createdAt,
            };
          }),
        total,
        page,
        pageSize,
      },
    });
  } catch (error) {
    console.error("Get bookmarks error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── 每日一文 ───────────────────────────────────────────────────

router.get("/daily-article", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    // 获取用户所属空间
    const memberships = await prisma.drSpaceMember.findMany({
      where: { userId: req.drUserId! },
    });

    if (memberships.length === 0) {
      res.json({
        code: 200,
        message: "success",
        data: { date: new Date().toISOString().split("T")[0], article: null, reason: "您还没有加入任何空间" },
      });
      return;
    }

    // 取第一个空间获取每日精选
    const spaceId = memberships[0].spaceId;

    const pickArticles = await prisma.drDailyPickArticle.findMany({
      where: { spaceId, enabled: true },
      orderBy: { sortOrder: "asc" },
    });

    if (pickArticles.length === 0) {
      res.json({
        code: 200,
        message: "success",
        data: { date: new Date().toISOString().split("T")[0], article: null, reason: "暂无精选文章" },
      });
      return;
    }

    // 计算当日索引
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayIndex = Math.floor(today.getTime() / 86400000);
    const spaceHash = hashString(spaceId);
    const selectedIndex = (dayIndex + spaceHash) % pickArticles.length;

    const selectedPick = pickArticles[selectedIndex];
    const article = await prisma.drArticle.findUnique({
      where: { articleId: selectedPick.articleId },
    });

    if (!article) {
      res.json({
        code: 200,
        message: "success",
        data: { date: new Date().toISOString().split("T")[0], article: null, reason: "文章不存在" },
      });
      return;
    }

    // 获取频道信息、编辑高亮和思维格栅
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

    const highlights = rawHighlights;

    res.json({
      code: 200,
      message: "success",
      data: {
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
          highlights,
        },
        reason: selectedPick.reason || "",
        lattice,
      },
    });
  } catch (error) {
    console.error("Get daily article error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── 批量同步接口 ───────────────────────────────────────────────────

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
  data?: {
    article_id?: string;
    bookmarked?: boolean;
  };
}

interface SyncReadProgressItem {
  local_id: string;
  action: "update";
  data?: {
    article_id?: string;
    progress?: number;
  };
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

// POST /sync - 批量同步
router.post("/sync", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { client_sync_id, last_sync_at, payload } = req.body as {
      client_sync_id?: string;
      last_sync_at?: string;
      payload?: {
        highlights?: SyncHighlightItem[];
        bookmarks?: SyncBookmarkItem[];
        read_progress?: SyncReadProgressItem[];
        reading_stats?: SyncReadingStatsItem[];
      };
    };

    const results = {
      highlights: [] as Array<{ local_id: string; remote_id?: string; status: string; error?: string }>,
      bookmarks: [] as Array<{ local_id: string; status: string; error?: string }>,
      read_progress: [] as Array<{ local_id: string; status: string; error?: string }>,
      reading_stats: [] as Array<{ local_id: string; status: string; error?: string }>,
    };

    // 处理高亮同步
    if (payload?.highlights && payload.highlights.length > 0) {
      for (const item of payload.highlights) {
        try {
          if (item.action === "create" && item.data) {
            const highlight = await prisma.drHighlight.create({
              data: {
                highlightId: generateId("H"),
                userId: req.drUserId!,
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
            if (existing && existing.userId === req.drUserId) {
              await prisma.drHighlight.delete({ where: { highlightId: item.remote_id } });
              results.highlights.push({ local_id: item.local_id, status: "success" });
            } else {
              results.highlights.push({ local_id: item.local_id, status: "failed", error: "无权删除或不存在" });
            }
          } else if (item.action === "update" && item.remote_id && item.data) {
            const existing = await prisma.drHighlight.findUnique({ where: { highlightId: item.remote_id } });
            if (existing && existing.userId === req.drUserId) {
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

    // 处理收藏同步
    if (payload?.bookmarks && payload.bookmarks.length > 0) {
      for (const item of payload.bookmarks) {
        try {
          if (item.action === "create" && item.data?.article_id) {
            await prisma.drBookmark.upsert({
              where: { userId_articleId: { userId: req.drUserId!, articleId: item.data.article_id } },
              update: {},
              create: { userId: req.drUserId!, articleId: item.data.article_id },
            });
            results.bookmarks.push({ local_id: item.local_id, status: "success" });
          } else if (item.action === "delete" && item.data?.article_id) {
            await prisma.drBookmark.deleteMany({
              where: { userId: req.drUserId!, articleId: item.data.article_id },
            });
            results.bookmarks.push({ local_id: item.local_id, status: "success" });
          }
        } catch (err) {
          results.bookmarks.push({ local_id: item.local_id, status: "failed", error: String(err) });
        }
      }
    }

    // 处理阅读进度同步
    if (payload?.read_progress && payload.read_progress.length > 0) {
      for (const item of payload.read_progress) {
        try {
          if (item.action === "update" && item.data?.article_id) {
            await prisma.drReadStatus.upsert({
              where: { userId_articleId: { userId: req.drUserId!, articleId: item.data.article_id } },
              update: { progress: item.data.progress ?? 100, readAt: new Date() },
              create: { userId: req.drUserId!, articleId: item.data.article_id, progress: item.data.progress ?? 100 },
            });
            results.read_progress.push({ local_id: item.local_id, status: "success" });
          }
        } catch (err) {
          results.read_progress.push({ local_id: item.local_id, status: "failed", error: String(err) });
        }
      }
    }

    // 处理阅读统计同步
    if (payload?.reading_stats && payload.reading_stats.length > 0) {
      for (const item of payload.reading_stats) {
        try {
          if (item.action === "create" && item.data?.article_id) {
            const statsId = `RS${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
            await prisma.drReadingStats.create({
              data: {
                statsId,
                userId: req.drUserId!,
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

    // 获取服务端变化（如果有 last_sync_at）
    type ServerChanges = {
      highlights: Array<{ highlightId: string; articleId: string; text: string; color: string; note: string; updatedAt: Date }>;
      bookmarks: unknown[];
      articles: unknown[];
    };
    let serverChanges: ServerChanges = { highlights: [], bookmarks: [], articles: [] };
    if (last_sync_at) {
      const syncDate = new Date(last_sync_at);
      const updatedHighlights = await prisma.drHighlight.findMany({
        where: { userId: req.drUserId!, updatedAt: { gte: syncDate } },
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

    res.json({
      code: 200,
      message: "同步成功",
      data: {
        server_sync_id: `sync-${Date.now()}`,
        synced_at: new Date().toISOString(),
        results,
        server_changes: serverChanges,
      },
    });
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// GET /sync/changes - 增量获取
router.get("/sync/changes", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const lastSyncAt = req.query.last_sync_at as string;
    const entityTypes = (req.query.entity_types as string)?.split(",") || ["highlights", "bookmarks", "read_progress"];

    if (!lastSyncAt) {
      res.status(400).json({ code: 400, message: "last_sync_at 不能为空" });
      return;
    }

    const syncDate = new Date(lastSyncAt);
    const changes: Record<string, { created: unknown[]; updated: unknown[]; deleted: string[] }> = {};

    // 获取高亮变化
    if (entityTypes.includes("highlights")) {
      const highlights = await prisma.drHighlight.findMany({
        where: { userId: req.drUserId!, updatedAt: { gte: syncDate } },
      });
      const createdHighlights = highlights.filter((h) => h.createdAt >= syncDate);
      const updatedHighlights = highlights.filter((h) => h.createdAt < syncDate);

      changes.highlights = {
        created: createdHighlights.map((h) => ({
          highlightId: h.highlightId,
          articleId: h.articleId,
          text: h.text,
          color: h.color,
          positionData: JSON.parse(h.positionData),
          note: h.note,
          createdAt: h.createdAt,
        })),
        updated: updatedHighlights.map((h) => ({
          highlightId: h.highlightId,
          color: h.color,
          note: h.note,
          updatedAt: h.updatedAt,
        })),
        deleted: [], // 需要 tombstone 表支持
      };
    }

    // 获取收藏变化
    if (entityTypes.includes("bookmarks")) {
      const bookmarks = await prisma.drBookmark.findMany({
        where: { userId: req.drUserId!, createdAt: { gte: syncDate } },
      });

      changes.bookmarks = {
        created: bookmarks.map((b) => ({
          articleId: b.articleId,
          createdAt: b.createdAt,
        })),
        updated: [],
        deleted: [], // 需要 tombstone 表支持
      };
    }

    // 获取阅读进度变化
    if (entityTypes.includes("read_progress")) {
      const readStatuses = await prisma.drReadStatus.findMany({
        where: { userId: req.drUserId!, readAt: { gte: syncDate } },
      });

      changes.read_progress = {
        created: [],
        updated: readStatuses.map((r) => ({
          articleId: r.articleId,
          progress: r.progress,
          readAt: r.readAt,
        })),
        deleted: [],
      };
    }

    res.json({
      code: 200,
      message: "success",
      data: {
        synced_at: new Date().toISOString(),
        changes,
      },
    });
  } catch (error) {
    console.error("Get sync changes error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── AI 对话 ───────────────────────────────────────────────────

router.post("/ai/chat", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { article_id, message } = req.body as { article_id?: string; message?: string };

    if (!message?.trim()) {
      res.status(400).json({ code: 400, message: "message 不能为空" });
      return;
    }

    const aiConfig = await prisma.drAiConfig.findFirst();
    if (!aiConfig || !aiConfig.enabled) {
      res.status(503).json({ code: 503, message: "AI 功能未启用" });
      return;
    }
    if (!aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
      res.status(503).json({ code: 503, message: "AI 配置不完整" });
      return;
    }

    const client = new OpenAI({
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (article_id) {
      const article = await prisma.drArticle.findUnique({ where: { articleId: article_id } });
      if (article) {
        messages.push({
          role: "system",
          content: `你是一个阅读助手，正在帮助用户理解以下文章。\n\n标题：${article.title}\n作者：${article.author}\n\n正文：\n${article.content}`,
        });
      }
    }

    messages.push({ role: "user", content: message.trim() });

    const completion = await client.chat.completions.create({
      model: aiConfig.model,
      messages,
    });

    const reply = completion.choices[0]?.message?.content ?? "";
    res.json({ code: 200, message: "success", data: { reply } });
  } catch (error) {
    console.error("AI chat error:", error);
    res.status(500).json({ code: 500, message: "AI 请求失败" });
  }
});

export default router;
