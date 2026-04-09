import { Router, Response } from "express";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import * as collectionService from "../../services/deepread/drCollectionService";

const router = Router();

// 5.1 Create collection
router.post("/collections", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ code: 400, message: "合集名称不能为空" });
      return;
    }

    const collection = await collectionService.createCollection(req.drUserId!, name);
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
    handleError(res, "Create collection error", error);
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

    const result = await collectionService.modifyCollectionArticle(req.drUserId!, collectionId, article_id, action);
    if ("error" in result) {
      res.status(result.status).json({ code: result.status, message: result.error });
      return;
    }

    res.json({ code: 200, message: action === "add" ? "已添加到合集" : "已从合集移除" });
  } catch (error) {
    handleError(res, "Collection article error", error);
  }
});

// 5.3 Get collections list
router.get("/collections", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const data = await collectionService.getCollections(req.drUserId!);
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Get collections error", error);
  }
});

export default router;
