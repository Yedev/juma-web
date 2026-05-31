import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Segmented, Select, Space } from "antd";
import { MobileOutlined } from "@ant-design/icons";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── 设备预设：不同机型对应不同视口宽高、圆角与刘海样式 ───────────────
type Notch = "none" | "island" | "punch";
interface Device {
  key: string;
  name: string;
  width: number;
  height: number;
  radius: number;
  notch: Notch;
}

const DEVICES: Device[] = [
  { key: "ip15", name: "iPhone 15", width: 390, height: 640, radius: 52, notch: "island" },
  { key: "ipmax", name: "iPhone 15 Pro Max", width: 430, height: 660, radius: 56, notch: "island" },
  { key: "se", name: "iPhone SE", width: 320, height: 568, radius: 40, notch: "none" },
  { key: "pixel", name: "Pixel 8", width: 412, height: 640, radius: 40, notch: "punch" },
  { key: "galaxy", name: "Galaxy S24", width: 360, height: 620, radius: 36, notch: "punch" },
];

// 字号 / 行距档位（与接入规范的 readerSetFontScale / readerSetLineHeight 对应）
const FONT_SCALES = [
  { label: "小", value: 0.875 },
  { label: "标准", value: 1 },
  { label: "大", value: 1.125 },
  { label: "特大", value: 1.25 },
];
const LINE_HEIGHTS = [
  { label: "紧凑", value: 1.5 },
  { label: "适中", value: 1.75 },
  { label: "宽松", value: 2 },
];

// 基础 + 兜底样式/脚本：仅当文档未自行实现 reader* 函数时生效（如旧文档或 Markdown）
const FALLBACK_HEAD = `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --reader-font-scale: 1; --reader-lh: 1.75; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #1a1a2e; background: #fff;
    font-size: calc(16px * var(--reader-font-scale));
    line-height: var(--reader-lh);
    -webkit-font-smoothing: antialiased;
    word-wrap: break-word;
  }
  img, video { max-width: 100%; height: auto; }
  html[data-reader-theme="dark"] body { background: #16161a; color: #e8e8f0; }
  html[data-reader-theme="dark"] a { color: #8ab4f8; }
  .reader-md-wrap { padding: 18px 16px; }
</style>
`;

// 注意：兜底脚本放在正文之后，用 if (!window.readerXxx) 守卫，
// 这样文档自己实现的函数优先，未实现时才安装兜底，绝不覆盖。
const FALLBACK_SCRIPT = `
<script>
(function () {
  var d = document;
  if (!window.readerSetTheme) {
    window.readerSetTheme = function (t) { d.documentElement.setAttribute('data-reader-theme', t === 'dark' ? 'dark' : 'light'); };
  }
  if (!window.readerSetFontScale) {
    window.readerSetFontScale = function (s) { d.documentElement.style.setProperty('--reader-font-scale', s); };
  }
  if (!window.readerSetLineHeight) {
    window.readerSetLineHeight = function (h) { d.documentElement.style.setProperty('--reader-lh', h); };
  }
})();
</script>
`;

function buildSrcDoc(content: string, contentType: string): string {
  const body =
    contentType === "markdown"
      ? `<div class="reader-md-wrap">${renderToStaticMarkup(
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>,
        )}</div>`
      : content || "";
  return `<!DOCTYPE html><html><head>${FALLBACK_HEAD}</head><body>${body}${FALLBACK_SCRIPT}</body></html>`;
}

export default function MobilePreviewModal({
  open,
  onClose,
  title,
  content,
  contentType = "html",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  content: string;
  contentType?: string;
}) {
  const [deviceKey, setDeviceKey] = useState("ip15");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [fontScale, setFontScale] = useState(1);
  const [lineHeight, setLineHeight] = useState(1.75);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const device = DEVICES.find((d) => d.key === deviceKey) ?? DEVICES[0];

  // 仅 content / contentType 变化时重建文档；主题/字号通过 JS 调用即时生效，不重载 iframe
  const srcDoc = useMemo(() => buildSrcDoc(content, contentType), [content, contentType]);

  // 模拟 App 行为：调用文档暴露的全局函数同步主题、字号、行距
  const applySettings = useCallback(() => {
    const win = iframeRef.current?.contentWindow as
      | (Window & {
          readerSetTheme?: (t: string) => void;
          readerSetFontScale?: (s: number) => void;
          readerSetLineHeight?: (h: number) => void;
        })
      | null
      | undefined;
    if (!win) return;
    try {
      win.readerSetTheme?.(theme);
      win.readerSetFontScale?.(fontScale);
      win.readerSetLineHeight?.(lineHeight);
    } catch {
      /* 跨域或文档未就绪时忽略 */
    }
  }, [theme, fontScale, lineHeight]);

  // 设置变化或弹窗打开时重新下发（iframe 已加载的情况下）
  useEffect(() => {
    if (open) applySettings();
  }, [open, applySettings]);

  const darkStage = theme === "dark";

  return (
    <Modal
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MobileOutlined />
          <span>{title || "手机预览"}</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={Math.max(520, device.width + 120)}
      styles={{ body: { padding: "12px 0 20px" } }}
    >
      {/* 工具栏：机型 / 主题 / 字号 / 行距 */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <Space size={[12, 10]} wrap style={{ justifyContent: "center" }}>
          <Select
            size="small"
            value={deviceKey}
            onChange={setDeviceKey}
            style={{ width: 160 }}
            options={DEVICES.map((d) => ({ value: d.key, label: d.name }))}
          />
          <Segmented
            size="small"
            value={theme}
            onChange={(v) => setTheme(v as "light" | "dark")}
            options={[
              { label: "浅色", value: "light" },
              { label: "深色", value: "dark" },
            ]}
          />
          <Segmented
            size="small"
            value={fontScale}
            onChange={(v) => setFontScale(v as number)}
            options={FONT_SCALES}
          />
          <Segmented
            size="small"
            value={lineHeight}
            onChange={(v) => setLineHeight(v as number)}
            options={LINE_HEIGHTS}
          />
        </Space>
      </div>

      {/* 模拟舞台背景随主题变化，便于观察暗色边缘效果 */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "20px 0",
          background: darkStage ? "#0d0d10" : "#f2f0eb",
          borderRadius: 12,
          transition: "background 0.25s",
        }}
      >
        {/* 手机外壳 */}
        <div
          style={{
            position: "relative",
            width: device.width + 24,
            height: device.height + 24,
            background: "#0a0a0a",
            borderRadius: device.radius + 10,
            padding: 12,
            boxShadow: "0 8px 30px rgba(0,0,0,0.28)",
          }}
        >
          {/* 刘海 / 挖孔 */}
          {device.notch === "island" && (
            <div
              style={{
                position: "absolute",
                top: 20,
                left: "50%",
                transform: "translateX(-50%)",
                width: 112,
                height: 28,
                background: "#0a0a0a",
                borderRadius: 16,
                zIndex: 2,
              }}
            />
          )}
          {device.notch === "punch" && (
            <div
              style={{
                position: "absolute",
                top: 22,
                left: "50%",
                transform: "translateX(-50%)",
                width: 11,
                height: 11,
                background: "#0a0a0a",
                borderRadius: "50%",
                zIndex: 2,
              }}
            />
          )}

          <iframe
            ref={iframeRef}
            title="mobile-preview"
            srcDoc={srcDoc}
            onLoad={applySettings}
            sandbox="allow-scripts allow-same-origin"
            style={{
              width: device.width,
              height: device.height,
              border: 0,
              borderRadius: device.radius - 6,
              background: "#fff",
              display: "block",
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
