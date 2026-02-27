import { useState, useEffect } from "react";
import { message, Spin } from "antd";
import { SaveOutlined, FormatPainterOutlined } from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import { adminClient } from "../api/client";

export default function ConfigManagement() {
  const [configValue, setConfigValue] = useState<string>("{}");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await adminClient.get("/api/admin/config");
      if (res.data.code === 200) {
        setConfigValue(res.data.data.configValue);
      }
    } catch {
      message.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(configValue);
      setConfigValue(JSON.stringify(parsed, null, 2));
      message.success("格式化成功");
    } catch {
      message.error("JSON 格式不合法，无法格式化");
    }
  };

  const handleSave = async () => {
    try {
      JSON.parse(configValue);
    } catch {
      message.error("JSON 格式不合法，请修正后再保存");
      return;
    }

    setSaving(true);
    try {
      const res = await adminClient.put("/api/admin/config", { configValue });
      if (res.data.code === 200) {
        message.success("配置已保存并发布");
      }
    } catch {
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <span
          onClick={handleFormat}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#999",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#333")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#999")}
        >
          <FormatPainterOutlined style={{ fontSize: 12 }} />
          格式化
        </span>
        <span
          onClick={saving ? undefined : handleSave}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: saving ? "#ccc" : "#333",
            cursor: saving ? "default" : "pointer",
            fontWeight: 500,
          }}
          onMouseEnter={(e) => { if (!saving) e.currentTarget.style.color = "#000"; }}
          onMouseLeave={(e) => { if (!saving) e.currentTarget.style.color = "#333"; }}
        >
          <SaveOutlined style={{ fontSize: 12 }} />
          {saving ? "保存中..." : "保存并发布"}
        </span>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <Spin />
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #e8e8e8",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <Editor
            height="calc(100vh - 220px)"
            defaultLanguage="json"
            value={configValue}
            onChange={(v) => setConfigValue(v || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'SF Mono', 'Fira Code', 'Menlo', monospace",
              formatOnPaste: true,
              tabSize: 2,
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              renderLineHighlight: "none",
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              scrollbar: {
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
              },
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>
      )}
    </div>
  );
}
