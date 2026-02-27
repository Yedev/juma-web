import { useState } from "react";
import { Input, Form, message } from "antd";
import { SendOutlined, RightOutlined, DownOutlined } from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import axios from "axios";
import { generateSign } from "../utils/sign";
import { BASE_URL } from "../api/client";

interface ApiDef {
  key: string;
  method: "GET" | "POST";
  path: string;
  title: string;
  description: string;
  headers: string;
  params: { name: string; type: string; desc: string; location: "query" | "body" }[];
  bodyExample?: string;
}

const apiList: ApiDef[] = [
  {
    key: "1",
    method: "GET",
    path: "/api/v1/app/config",
    title: "获取应用配置",
    description: "返回数据库中存储的全局 JSON 配置",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [],
  },
  {
    key: "2",
    method: "POST",
    path: "/api/v1/app/task/execute",
    title: "任务执行(触发器)",
    description: "提交任务到后端，返回新任务ID",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [
      { name: "task_name", type: "string", desc: "任务名称", location: "body" },
      { name: "task_params", type: "object", desc: "任务参数 (JSON对象)", location: "body" },
    ],
    bodyExample: JSON.stringify(
      { task_name: "数据分析任务", task_params: { target: "user_data" } },
      null,
      2
    ),
  },
  {
    key: "3",
    method: "GET",
    path: "/api/v1/app/task/status",
    title: "任务状态查询",
    description: "根据 task_id 查询任务当前状态",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [{ name: "task_id", type: "string", desc: "任务ID (如 T1709001234)", location: "query" }],
  },
];

function MethodBadge({ method }: { method: string }) {
  const color = method === "GET" ? "#52c41a" : "#1890ff";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "monospace",
        color,
        minWidth: 36,
      }}
    >
      {method}
    </span>
  );
}

function ApiPanel({ api }: { api: ApiDef }) {
  const [response, setResponse] = useState<string>("");
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [bodyValue, setBodyValue] = useState(api.bodyExample || "");

  const handleSend = async () => {
    setLoading(true);
    setResponse("");
    setStatusCode(null);

    const { timestamp, sign } = generateSign();
    const headers: Record<string, string> = {
      "x-timestamp": timestamp,
      "x-sign": sign,
    };

    try {
      let res;
      const url = `${BASE_URL}${api.path}`;

      if (api.method === "GET") {
        const formValues = form.getFieldsValue();
        const queryParams: Record<string, string> = {};
        api.params.forEach((p) => {
          if (formValues[p.name]) queryParams[p.name] = formValues[p.name];
        });
        res = await axios.get(url, { headers, params: queryParams });
      } else {
        let body = {};
        if (bodyValue) {
          try {
            body = JSON.parse(bodyValue);
          } catch {
            message.error("请求体 JSON 格式不合法");
            setLoading(false);
            return;
          }
        }
        headers["Content-Type"] = "application/json";
        res = await axios.post(url, body, { headers });
      }

      setStatusCode(res.status);
      setResponse(JSON.stringify(res.data, null, 2));
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: unknown }; message?: string };
      setStatusCode(error.response?.status || 0);
      setResponse(
        JSON.stringify(error.response?.data || { error: error.message }, null, 2)
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "16px 0 8px" }}>
      {/* Meta */}
      <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#999", marginBottom: 12 }}>
        <span>{api.description}</span>
      </div>
      <div style={{ fontSize: 12, color: "#bbb", marginBottom: 16 }}>
        Header: {api.headers}
        <span style={{ marginLeft: 8, color: "#ccc" }}>(签名自动注入)</span>
      </div>

      {/* Query params */}
      {api.params.some((p) => p.location === "query") && (
        <Form form={form} layout="inline" style={{ marginBottom: 12 }}>
          {api.params
            .filter((p) => p.location === "query")
            .map((p) => (
              <Form.Item key={p.name} label={<span style={{ fontSize: 12, color: "#666" }}>{p.name}</span>} name={p.name}>
                <Input
                  placeholder={p.desc}
                  style={{ width: 220, height: 32, fontSize: 13, borderColor: "#e0e0e0", borderRadius: 4 }}
                />
              </Form.Item>
            ))}
        </Form>
      )}

      {/* Body editor */}
      {api.params.some((p) => p.location === "body") && (
        <div
          style={{
            border: "1px solid #e8e8e8",
            borderRadius: 4,
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          <Editor
            height="100px"
            defaultLanguage="json"
            value={bodyValue}
            onChange={(v) => setBodyValue(v || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: "'SF Mono', monospace",
              scrollBeyondLastLine: false,
              lineNumbers: "off",
              renderLineHighlight: "none",
              overviewRulerBorder: false,
              scrollbar: { verticalScrollbarSize: 4, horizontalScrollbarSize: 4 },
              padding: { top: 8, bottom: 8 },
            }}
          />
        </div>
      )}

      {/* Send button */}
      <div style={{ marginBottom: 12 }}>
        <span
          onClick={loading ? undefined : handleSend}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: loading ? "#ccc" : "#333",
            cursor: loading ? "default" : "pointer",
            fontWeight: 500,
            padding: "6px 14px",
            border: "1px solid #e0e0e0",
            borderRadius: 4,
            background: "#fafafa",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.borderColor = "#bbb"; e.currentTarget.style.background = "#f0f0f0"; } }}
          onMouseLeave={(e) => { if (!loading) { e.currentTarget.style.borderColor = "#e0e0e0"; e.currentTarget.style.background = "#fafafa"; } }}
        >
          <SendOutlined style={{ fontSize: 11 }} />
          {loading ? "发送中..." : "发送请求"}
        </span>
      </div>

      {/* Response */}
      {(response || statusCode !== null) && (
        <div>
          <div style={{ fontSize: 12, color: "#999", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
            响应结果
            {statusCode !== null && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: statusCode >= 200 && statusCode < 300 ? "#52c41a" : "#ff4d4f",
                }}
              >
                HTTP {statusCode}
              </span>
            )}
          </div>
          <pre
            style={{
              background: "#fafafa",
              border: "1px solid #e8e8e8",
              borderRadius: 4,
              color: "#333",
              padding: 14,
              maxHeight: 280,
              overflow: "auto",
              fontSize: 12,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            {response}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function ApiPlayground() {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div>
      <div style={{ fontSize: 13, color: "#999", marginBottom: 20 }}>
        以下为提供给移动端的 3 个接口，点击展开可查看文档并在线测试。
      </div>

      <div>
        {apiList.map((api) => {
          const isOpen = openKey === api.key;
          return (
            <div
              key={api.key}
              style={{
                borderBottom: "1px solid #f0f0f0",
              }}
            >
              {/* Header */}
              <div
                onClick={() => setOpenKey(isOpen ? null : api.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 0",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ fontSize: 10, color: "#ccc", transition: "transform 0.2s" }}>
                  {isOpen ? <DownOutlined /> : <RightOutlined />}
                </span>
                <MethodBadge method={api.method} />
                <span style={{ fontSize: 13, color: "#333", fontFamily: "monospace" }}>
                  {api.path}
                </span>
                <span style={{ fontSize: 12, color: "#bbb", marginLeft: 4 }}>
                  — {api.title}
                </span>
              </div>

              {/* Content */}
              {isOpen && (
                <div style={{ paddingLeft: 32, paddingBottom: 16 }}>
                  <ApiPanel api={api} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
