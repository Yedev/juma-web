import { Router, Response } from "express";
import OpenAI from "openai";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import * as aiService from "../../services/deepread/drAiService";

const router = Router();

router.post("/ai/chat", async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const { provider_model, messages } = req.body as {
      provider_model?: string;
      messages?: OpenAI.Chat.ChatCompletionMessageParam[];
    };

    if (!provider_model?.trim()) {
      res.status(400).json({ code: 400, message: "provider_model 不能为空，格式：providerName-modelName" });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ code: 400, message: "messages 不能为空" });
      return;
    }

    const result = await aiService.chat(req.drUserId!, provider_model.trim(), messages);
    if ("error" in result) {
      res.status(result.status).json({ code: result.status, message: result.error });
      return;
    }

    res.json({ code: 200, message: "success", data: result.data });
  } catch (error) {
    handleError(res, "AI chat error", error);
  }
});

export default router;
