import { useState } from "react";
import { Input, Form, message } from "antd";
import { SendOutlined, RightOutlined, DownOutlined } from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import axios from "axios";
import { generateSign } from "../utils/sign";
import { BASE_URL } from "../api/client";

interface ApiDef {
  key: string;
  method: "GET" | "POST" | "PUT";
  path: string;
  title: string;
  description: string;
  headers: string;
  params: { name: string; type: string; desc: string; location: "query" | "body" }[];
  bodyExample?: string;
  curlExample: string;
}

const signInitScript = [
  "APP_SECRET=\"juma2026_secret\"",
  "BASE_URL=\"http://localhost:3001\"",
  "TS=$(date +%s%3N)",
  "SIGN=$(printf \"%s\" \"${APP_SECRET}${TS}\" | md5sum | awk '{print $1}')",
].join("\n");

const apiList: ApiDef[] = [
  {
    key: "1",
    method: "GET",
    path: "/api/v1/app/config",
    title: "获取应用配置",
    description: "按 key 返回对应的 JSON 配置，不传 key 默认返回 global_json",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [{ name: "key", type: "string", desc: "配置键名 (如 global_json)", location: "query" }],
    curlExample: [
      signInitScript,
      "",
      "curl --request GET \"${BASE_URL}/api/v1/app/config?key=global_json\" \\",
      "  --header \"x-timestamp: ${TS}\" \\",
      "  --header \"x-sign: ${SIGN}\"",
    ].join("\n"),
  },
  {
    key: "2",
    method: "GET",
    path: "/api/v1/app/task/catalog",
    title: "查询支持任务列表",
    description: "返回服务端已注册的全部 task 定义（包含执行类型、参数说明、示例入参）",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [],
    curlExample: [
      signInitScript,
      "",
      "curl --request GET \"${BASE_URL}/api/v1/app/task/catalog\" \\",
      "  --header \"x-timestamp: ${TS}\" \\",
      "  --header \"x-sign: ${SIGN}\"",
    ].join("\n"),
  },
  {
    key: "3",
    method: "POST",
    path: "/api/v1/app/task/execute",
    title: "任务执行(触发器)",
    description:
      "提交任务到后端，返回新任务ID。仅支持已注册 task_name：server.echo / client.echo / client.mock3s。未注册 task 会返回 404（任务不存在）。",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [
      {
        name: "task_name",
        type: "string",
        desc: "任务名称（server.echo / client.echo / client.mock3s）",
        location: "body",
      },
      {
        name: "task_payload",
        type: "object",
        desc: "任务参数（不同 task_name 的参数结构不同）",
        location: "body",
      },
    ],
    bodyExample: JSON.stringify(
      {
        task_name: "server.echo",
        task_payload: {
          message: "同步商品索引",
          repeat: 3,
          sleep_ms: 400,
        },
        execution_name: "sync-product-index-001",
      },
      null,
      2
    ),
    curlExample: [
      signInitScript,
      "",
      "# 1) 服务器执行示例（server_task）",
      "curl --request POST \"${BASE_URL}/api/v1/app/task/execute\" \\",
      "  --header \"Content-Type: application/json\" \\",
      "  --header \"x-timestamp: ${TS}\" \\",
      "  --header \"x-sign: ${SIGN}\" \\",
      "  --data '{\"task_name\":\"server.echo\",\"task_payload\":{\"message\":\"同步商品索引\",\"repeat\":3,\"sleep_ms\":400},\"execution_name\":\"sync-product-index-001\"}'",
      "",
      "# 2) 客户端执行示例（client_task）",
      "curl --request POST \"${BASE_URL}/api/v1/app/task/execute\" \\",
      "  --header \"Content-Type: application/json\" \\",
      "  --header \"x-timestamp: ${TS}\" \\",
      "  --header \"x-sign: ${SIGN}\" \\",
      "  --data '{\"task_name\":\"client.mock3s\",\"task_payload\":{\"payload\":{\"build_id\":\"build-20260302-001\",\"branch\":\"main\",\"notify\":true},\"required_tags\":[\"xcode\"]}}'",
      "",
      "# 3) 未注册任务示例（将返回 404 任务不存在）",
      "curl --request POST \"${BASE_URL}/api/v1/app/task/execute\" \\",
      "  --header \"Content-Type: application/json\" \\",
      "  --header \"x-timestamp: ${TS}\" \\",
      "  --header \"x-sign: ${SIGN}\" \\",
      "  --data '{\"task_name\":\"client.not-exists\",\"task_payload\":{}}'",
    ].join("\n"),
  },
  {
    key: "4",
    method: "PUT",
    path: "/api/v1/app/task/status",
    title: "更新任务状态",
    description: "更新任务状态及附加信息 (queued/running/error/completed)",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [
      { name: "task_id", type: "string", desc: "任务ID", location: "body" },
      { name: "status", type: "string", desc: "状态: queued/running/error/completed", location: "body" },
      { name: "status_info", type: "object", desc: "状态附加信息", location: "body" },
    ],
    bodyExample: JSON.stringify(
      { task_id: "T1709001234", status: "running", status_info: { current_step: "2/5 处理数据", progress: 40 } },
      null,
      2
    ),
    curlExample: [
      signInitScript,
      "",
      "curl --request PUT \"${BASE_URL}/api/v1/app/task/status\" \\",
      "  --header \"Content-Type: application/json\" \\",
      "  --header \"x-timestamp: ${TS}\" \\",
      "  --header \"x-sign: ${SIGN}\" \\",
      "  --data '{\"task_id\":\"T1709001234\",\"status\":\"running\",\"status_info\":{\"current_step\":\"2/5 处理数据\",\"progress\":40}}'",
    ].join("\n"),
  },
  {
    key: "5",
    method: "GET",
    path: "/api/v1/app/task/status",
    title: "任务状态查询",
    description: "根据 task_id 查询任务当前状态及详情（含任务参数、日志、执行节点、时间信息）",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [{ name: "task_id", type: "string", desc: "任务ID (如 T1709001234)", location: "query" }],
    curlExample: [
      signInitScript,
      "",
      "curl --request GET \"${BASE_URL}/api/v1/app/task/status?task_id=T1709001234\" \\",
      "  --header \"x-timestamp: ${TS}\" \\",
      "  --header \"x-sign: ${SIGN}\"",
    ].join("\n"),
  },
];

function MethodBadge({ method }: { method: string }) {
  const color = method === "GET" ? "#52c41a" : method === "PUT" ? "#fa8c16" : "#1890ff";
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
        if (api.method === "PUT") {
          res = await axios.put(url, body, { headers });
        } else {
          res = await axios.post(url, body, { headers });
        }
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
        <span style={{ marginLeft: 8, color: "#ccc" }}>(在线调试发送时自动注入签名)</span>
      </div>

      <div
        style={{
          background: "#fafafa",
          border: "1px solid #f0f0f0",
          borderRadius: 4,
          padding: "10px 12px",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>参数说明</div>
        {api.params.length === 0 ? (
          <div style={{ fontSize: 12, color: "#999" }}>无参数</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {api.params.map((p) => (
              <div
                key={p.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 120px 1fr",
                  gap: 12,
                  fontSize: 12,
                  color: "#666",
                }}
              >
                <span style={{ fontFamily: "monospace", color: "#333" }}>{p.name}</span>
                <span>
                  {p.location === "query" ? "Query" : "Body"} · {p.type}
                </span>
                <span style={{ color: "#999" }}>{p.desc}</span>
              </div>
            ))}
          </div>
        )}
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

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#999", marginBottom: 6 }}>curl 示例 (含 x-sign 计算)</div>
        <pre
          style={{
            background: "#fafafa",
            border: "1px solid #e8e8e8",
            borderRadius: 4,
            color: "#333",
            padding: 12,
            maxHeight: 220,
            overflow: "auto",
            fontSize: 12,
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            margin: 0,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {api.curlExample}
        </pre>
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
      <div
        style={{
          background: "#fafafa",
          border: "1px solid #e8e8e8",
          borderRadius: 4,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 500, color: "#333", marginBottom: 10 }}>
          鉴权说明（重点：x-sign）
        </div>
        <div style={{ fontSize: 12, color: "#666", lineHeight: 1.8 }}>
          <div>1) App 端接口都在 <code>/api/v1/app/*</code> 下，请求必须带签名头。</div>
          <div>2) x-timestamp 为 13 位毫秒时间戳，服务端允许误差 ±5 分钟，超时返回 403。</div>
          <div>3) x-sign 计算公式：<code>MD5(APP_SECRET + x-timestamp)</code>，不通过返回 401。</div>
          <div>4) 当前默认 APP_SECRET: <code>juma2026_secret</code>（生产环境请使用环境变量覆盖）。</div>
        </div>
        <div style={{ fontSize: 12, color: "#999", marginTop: 10, marginBottom: 6 }}>
          Linux/macOS (md5sum) 生成签名示例：
        </div>
        <pre
          style={{
            background: "#fff",
            border: "1px solid #f0f0f0",
            borderRadius: 4,
            padding: 10,
            margin: 0,
            fontSize: 12,
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {signInitScript}
        </pre>
      </div>

      <div style={{ fontSize: 13, color: "#999", marginBottom: 20 }}>
        以下为提供给移动端的 {apiList.length} 个接口，点击展开可查看详细文档、curl 示例并在线测试。
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
