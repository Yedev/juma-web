import { useState, useEffect } from "react";
import { Button, Space, Typography, message, Spin } from "antd";
import { SaveOutlined, FormatPainterOutlined } from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import { adminClient } from "../api/client";

const { Title } = Typography;

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
      <Space style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <Title level={4} style={{ margin: 0 }}>
          配置管理
        </Title>
        <Space>
          <Button icon={<FormatPainterOutlined />} onClick={handleFormat}>
            格式化
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
            保存并发布
          </Button>
        </Space>
      </Space>
      {loading ? (
        <Spin size="large" />
      ) : (
        <div style={{ border: "1px solid #d9d9d9", borderRadius: 6 }}>
          <Editor
            height="65vh"
            defaultLanguage="json"
            value={configValue}
            onChange={(v) => setConfigValue(v || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              formatOnPaste: true,
              tabSize: 2,
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      )}
    </div>
  );
}
