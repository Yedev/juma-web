const ARK_API_KEY = "0aa7c7fa-36b1-45b5-9912-351bb7ac0e98";
const ARK_API_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DEFAULT_MODEL = "doubao-seed-2-0-pro-260215";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallAIOptions {
  model?: string;
  messages: ChatMessage[];
}

const AI_TIMEOUT_MS = 180_000;

/**
 * 调用豆包大模型（火山引擎 ARK）
 */
export async function callAI(options: CallAIOptions): Promise<string> {
  const { model = DEFAULT_MODEL, messages } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ARK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error("ARK API error:", res.status, errText);
    throw new Error(`AI 服务请求失败: ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * 将文章内容格式化为适合手机阅读的 HTML
 */
export async function beautifyToHtml(rawContent: string): Promise<string> {
  const systemPrompt = `你是一名专业的内容排版编辑，擅长将原始文字内容转换为适合手机阅读的精美 HTML 格式。

请遵循以下排版规范：
1. 使用语义化 HTML 标签：<h2>/<h3> 作为标题，<p> 作为正文段落，<ul>/<ol>/<li> 作为列表，<blockquote> 作为引用，<strong> 加粗重点
2. 每个段落之间要有合适的间距，不要让内容堆在一起
3. 保留原文的所有信息，不增删内容
4. 不要添加任何 CSS 样式属性，只使用语义化标签
5. 不要输出 <!DOCTYPE>、<html>、<head>、<body> 等外层包裹标签，只输出正文 HTML 片段
6. 输出结果直接是 HTML 代码，不需要 Markdown 代码块包裹`;

  const userPrompt = `请将以下内容格式化为适合手机阅读的 HTML 格式：\n\n${rawContent}`;

  return await callAI({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
}

/**
 * 基于文章内容回答用户问题（DeepRead 阅读助手）
 */
export async function chatWithArticle(
  articleTitle: string,
  articleContent: string,
  userMessage: string
): Promise<string> {
  return await callAI({
    messages: [
      {
        role: "system",
        content: "你是 DeepRead 阅读助手。基于以下文章内容回答用户的问题。",
      },
      {
        role: "user",
        content: `文章标题：${articleTitle}\n\n文章内容：\n${articleContent.slice(0, 8000)}\n\n用户问题：${userMessage}`,
      },
    ],
  });
}
