import { Router, Response } from "express";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import * as syncService from "../../services/deepread/drSyncService";

const router = Router();

// POST /sync - 批量同步
router.post("/sync", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { last_sync_at, payload } = req.body as {
      client_sync_id?: string;
      last_sync_at?: string;
      payload?: {
        highlights?: unknown[];
        bookmarks?: unknown[];
        read_progress?: unknown[];
        reading_stats?: unknown[];
      };
    };

    const { results, serverChanges } = await syncService.processSync(
      req.drUserId!,
      last_sync_at,
      payload as Parameters<typeof syncService.processSync>[2],
    );

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
    handleError(res, "Sync error", error);
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

    const changes = await syncService.getChanges(req.drUserId!, lastSyncAt, entityTypes);

    res.json({
      code: 200,
      message: "success",
      data: { synced_at: new Date().toISOString(), changes },
    });
  } catch (error) {
    handleError(res, "Get sync changes error", error);
  }
});

export default router;
