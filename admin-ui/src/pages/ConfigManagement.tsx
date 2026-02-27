import { useState, useEffect, useCallback } from "react";
import { message, Spin, Input, Modal } from "antd";
import {
  SaveOutlined,
  FormatPainterOutlined,
  PlusOutlined,
  DeleteOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import { adminClient } from "../api/client";

interface ConfigItem {
  id: number;
  configKey: string;
  updatedAt: string;
}

export default function ConfigManagement() {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [configValue, setConfigValue] = useState<string>("{}");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await adminClient.get("/api/admin/configs");
      if (res.data.code === 200) {
        setConfigs(res.data.data);
      }
    } catch {
      message.error("加载配置列表失败");
    } finally {
      setListLoading(false);
    }
  }, []);

  const fetchConfigValue = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/config/${encodeURIComponent(key)}`);
      if (res.data.code === 200) {
        setConfigValue(res.data.data.configValue);
      }
    } catch {
      message.error("加载配置失败");
      setConfigValue("{}");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  useEffect(() => {
    if (configs.length > 0 && !activeKey) {
      const first = configs[0].configKey;
      setActiveKey(first);
      fetchConfigValue(first);
    }
  }, [configs, activeKey, fetchConfigValue]);

  const handleSelectKey = (key: string) => {
    if (key === activeKey) return;
    setActiveKey(key);
    fetchConfigValue(key);
  };

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
    if (!activeKey) return;
    try {
      JSON.parse(configValue);
    } catch {
      message.error("JSON 格式不合法，请修正后再保存");
      return;
    }

    setSaving(true);
    try {
      const res = await adminClient.put(
        `/api/admin/config/${encodeURIComponent(activeKey)}`,
        { configValue }
      );
      if (res.data.code === 200) {
        message.success("配置已保存并发布");
        fetchConfigs();
      }
    } catch {
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateKey = async () => {
    const key = newKeyName.trim();
    if (!key) {
      message.error("请输入配置键名");
      return;
    }
    if (configs.some((c) => c.configKey === key)) {
      message.error("该键名已存在");
      return;
    }

    try {
      const res = await adminClient.put(
        `/api/admin/config/${encodeURIComponent(key)}`,
        { configValue: JSON.stringify({}, null, 2) }
      );
      if (res.data.code === 200) {
        message.success("配置已创建");
        setShowNewInput(false);
        setNewKeyName("");
        await fetchConfigs();
        setActiveKey(key);
        setConfigValue(JSON.stringify({}, null, 2));
      }
    } catch {
      message.error("创建失败");
    }
  };

  const handleDeleteKey = (key: string) => {
    Modal.confirm({
      title: "确认删除",
      content: `确定要删除配置 "${key}" 吗？此操作不可恢复。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await adminClient.delete(
            `/api/admin/config/${encodeURIComponent(key)}`
          );
          if (res.data.code === 200) {
            message.success("配置已删除");
            if (activeKey === key) {
              setActiveKey(null);
              setConfigValue("{}");
            }
            fetchConfigs();
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  return (
    <div style={{ display: "flex", gap: 0, height: "calc(100vh - 172px)" }}>
      {/* Left: Key list */}
      <div
        style={{
          width: 220,
          borderRight: "1px solid #f0f0f0",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {/* List header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px 12px",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "#333" }}>
            配置列表
          </span>
          <span
            onClick={() => setShowNewInput(true)}
            style={{
              fontSize: 12,
              color: "#999",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#333")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#999")}
          >
            <PlusOutlined style={{ fontSize: 11 }} />
            新建
          </span>
        </div>

        {/* New key input */}
        {showNewInput && (
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0" }}>
            <Input
              size="small"
              placeholder="输入键名，回车确认"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onPressEnter={handleCreateKey}
              onBlur={() => {
                if (!newKeyName.trim()) {
                  setShowNewInput(false);
                }
              }}
              autoFocus
              style={{ fontSize: 12, borderColor: "#e0e0e0", borderRadius: 4 }}
            />
          </div>
        )}

        {/* Key items */}
        <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
          {listLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
              <Spin size="small" />
            </div>
          ) : configs.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: "#ccc", textAlign: "center" }}>
              暂无配置
            </div>
          ) : (
            configs.map((cfg) => {
              const isActive = activeKey === cfg.configKey;
              const isHovered = hoveredKey === cfg.configKey;
              return (
                <div
                  key={cfg.configKey}
                  onClick={() => handleSelectKey(cfg.configKey)}
                  onMouseEnter={() => setHoveredKey(cfg.configKey)}
                  onMouseLeave={() => setHoveredKey(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    margin: "1px 6px",
                    borderRadius: 4,
                    cursor: "pointer",
                    background: isActive ? "#f0f0f0" : isHovered ? "#f7f7f7" : "transparent",
                    transition: "background 0.12s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    <FileTextOutlined style={{ fontSize: 12, color: "#bbb", flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: 13,
                        color: isActive ? "#333" : "#666",
                        fontWeight: isActive ? 500 : 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {cfg.configKey}
                    </span>
                  </div>
                  {isHovered && (
                    <DeleteOutlined
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteKey(cfg.configKey);
                      }}
                      style={{ fontSize: 11, color: "#ccc", flexShrink: 0 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ff4d4f")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#ccc")}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right: Editor */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {activeKey ? (
          <>
            {/* Editor toolbar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 16px 12px",
                borderBottom: "1px solid #f0f0f0",
              }}
            >
              <span style={{ fontSize: 13, color: "#999", fontFamily: "monospace" }}>
                {activeKey}
              </span>
              <div style={{ display: "flex", gap: 16 }}>
                <span
                  onClick={handleFormat}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    color: "#999",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#333")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#999")}
                >
                  <FormatPainterOutlined style={{ fontSize: 11 }} />
                  格式化
                </span>
                <span
                  onClick={saving ? undefined : handleSave}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    color: saving ? "#ccc" : "#333",
                    cursor: saving ? "default" : "pointer",
                    fontWeight: 500,
                  }}
                  onMouseEnter={(e) => { if (!saving) e.currentTarget.style.color = "#000"; }}
                  onMouseLeave={(e) => { if (!saving) e.currentTarget.style.color = "#333"; }}
                >
                  <SaveOutlined style={{ fontSize: 11 }} />
                  {saving ? "保存中..." : "保存并发布"}
                </span>
              </div>
            </div>

            {/* Editor */}
            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
                <Spin />
              </div>
            ) : (
              <div style={{ flex: 1, overflow: "hidden" }}>
                <Editor
                  height="100%"
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
                    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ccc",
              fontSize: 13,
            }}
          >
            请选择一个配置或新建配置
          </div>
        )}
      </div>
    </div>
  );
}
