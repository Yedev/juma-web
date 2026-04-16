import { Router, Response } from "express";
import OpenAI from "openai";
import { DrAuthRequest } from "../../middleware/drAuth";
import { handleError } from "../../lib/errors";
import { aiRateLimit } from "../../middleware/rateLimit";
import * as aiService from "../../services/deepread/drAiService";

const router = Router();

function validateChatRequest(body: unknown):
  | { providerModel: string; messages: OpenAI.Chat.ChatCompletionMessageParam[] }
  | { error: string } {
  const { provider_model, messages } = (body ?? {}) as {
    provider_model?: string;
    messages?: OpenAI.Chat.ChatCompletionMessageParam[];
  };

  if (!provider_model?.trim()) {
    return { error: "provider_model 不能为空，格式：providerName-modelName" };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: "messages 不能为空" };
  }

  return {
    providerModel: provider_model.trim(),
    messages,
  };
}

router.post("/ai/chat", aiRateLimit, async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const payload = validateChatRequest(req.body);
    if ("error" in payload) {
      res.status(400).json({ code: 400, message: payload.error });
      return;
    }

    const result = await aiService.chat(req.drUserId!, payload.providerModel, payload.messages);
    if ("error" in result) {
      res.status(result.status).json({ code: result.status, message: result.error });
      return;
    }

    res.json({ code: 200, message: "success", data: result.data });
  } catch (error) {
    handleError(res, "AI chat error", error);
  }
});

router.post("/ai/chat/stream", aiRateLimit, async (req: DrAuthRequest, res: Response): Promise<void> => {
  try {
    const payload = validateChatRequest(req.body);
    if ("error" in payload) {
      res.status(400).json({ code: 400, message: payload.error });
      return;
    }

    const result = await aiService.chatStream(req.drUserId!, payload.providerModel, payload.messages);
    if ("error" in result) {
      res.status(result.status).json({ code: result.status, message: result.error });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let clientClosed = false;
    req.on("close", () => {
      clientClosed = true;
      result.stream.controller.abort();
    });

    res.write(`data: ${JSON.stringify({ code: 200, message: "stream-start" })}\n\n`);

    for await (const chunk of result.stream) {
      if (clientClosed) {
        break;
      }

      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (!delta) {
        continue;
      }

      res.write(`data: ${JSON.stringify({ type: "delta", content: delta })}\n\n`);
    }

    if (!clientClosed) {
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    }
  } catch (error) {
    if (!res.headersSent) {
      handleError(res, "AI chat stream error", error);
      return;
    }

    res.write(`data: ${JSON.stringify({ type: "error", message: "AI stream interrupted" })}\n\n`);
    res.end();
  }
});

export default router;
