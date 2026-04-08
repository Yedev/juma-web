import { useState, useEffect } from "react";
import { message, Button, Input, Switch, Card, Space, Tag } from "antd";
import { SaveOutlined, RobotOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface AiConfig {
  id: number;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export default function DrAiConfig() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await adminClient.get("/api/admin/dr/ai-config");
      if (res.data.code === 200 && res.data.data) {
        const c: AiConfig = res.data.data;
        setConfig(c);
        setBaseUrl(c.baseUrl);
        setApiKey(c.apiKey);
        setModel(c.model);
        setEnabled(c.enabled);
      }
    } catch {
      message.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      message.error("Base URL、API Key、模型名称均不能为空");
      return;
    }
    setSaving(true);
    try {
      const res = await adminClient.put("/api/admin/dr/ai-config", {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        enabled,
      });
      if (res.data.code === 200) {
        message.success("配置已保存");
        setConfig(res.data.data);
      }
    } catch {
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Space>
          <RobotOutlined style={{ fontSize: 16 }} />
          <span style={{ fontSize: 15, fontWeight: 500 }}>AI 模型配置</span>
          {config && (
            <Tag color={config.enabled ? "green" : "default"}>{config.enabled ? "已启用" : "已禁用"}</Tag>
          )}
        </Space>
      </div>

      <Card size="small" loading={loading}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Base URL</div>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="例如：https://ark.cn-beijing.volces.com/api/v3"
            />
            <div style={{ fontSize: 12, color: "#bbb", marginTop: 4 }}>
              兼容 OpenAI 格式的接口地址，豆包填火山引擎 ARK 地址
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>API Key</div>
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="填写对应平台的 API Key"
            />
          </div>

          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>模型名称</div>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="例如：doubao-pro-32k、gpt-4o、ep-xxxxxxxx"
            />
            <div style={{ fontSize: 12, color: "#bbb", marginTop: 4 }}>
              填写模型 ID，豆包推理接入点填 ep- 开头的接入点 ID
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Switch
              checked={enabled}
              onChange={setEnabled}
              checkedChildren="启用"
              unCheckedChildren="禁用"
            />
            <span style={{ fontSize: 13, color: "#666" }}>AI 对话功能开关</span>
          </div>

          <div style={{ paddingTop: 8 }}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              保存配置
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
