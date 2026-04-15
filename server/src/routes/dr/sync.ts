import { Router, Response } from "express";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import * as syncService from "../../services/deepread/drSyncService";

const router = Router();

// POST /sync/export — 返回用户备份字符串
router.post("/sync/export", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const data = await syncService.exportData(req.drUserId!);
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    handleError(res, "Export data error", error);
  }
});

// POST /sync/import — 接收并存储用户备份字符串
router.post("/sync/import", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { data } = req.body as { data?: string };
    if (data === undefined || data === null) {
      res.status(400).json({ code: 400, message: "data 不能为空" });
      return;
    }

    await syncService.importData(req.drUserId!, data);
    res.json({ code: 200, message: "导入成功" });
  } catch (error) {
    handleError(res, "Import data error", error);
  }
});

export default router;
