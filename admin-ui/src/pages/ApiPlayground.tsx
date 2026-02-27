import { useState } from "react";
import {
  Typography,
  Collapse,
  Tag,
  Button,
  Input,
  Form,
  Space,
  Card,
  message,
} from "antd";
import { SendOutlined } from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import axios from "axios";
import { generateSign } from "../utils/sign";
import { BASE_URL } from "../api/client";

const { Title, Text, Paragraph } = Typography;

interface ApiDef {
  key: string;
  method: "GET" | "POST";
  path: string;
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
    description: "获取应用配置 — 返回数据库中存储的全局 JSON 配置",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [],
  },
  {
    key: "2",
    method: "POST",
    path: "/api/v1/app/task/execute",
    description: "任务执行(触发器) — 提交任务到后端，返回新任务ID",
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
    description: "任务状态查询 — 根据 task_id 查询任务当前状态",
    headers: "x-timestamp (13位毫秒时间戳), x-sign (MD5签名)",
    params: [{ name: "task_id", type: "string", desc: "任务ID (如 T1709001234)", location: "query" }],
  },
];

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

  const methodColor = api.method === "GET" ? "green" : "blue";

  return (
    <div>
      <Paragraph>
        <Text strong>请求方式：</Text>
        <Tag color={methodColor}>{api.method}</Tag>
        <Text code>{api.path}</Text>
      </Paragraph>
      <Paragraph>
        <Text strong>Header 要求：</Text> {api.headers}
      </Paragraph>
      <Paragraph type="secondary">
        签名将在发送请求时自动计算并注入 (x-timestamp + x-sign)
      </Paragraph>

      {api.params.length > 0 && (
        <Card size="small" title="请求参数" style={{ marginBottom: 12 }}>
          {api.params.some((p) => p.location === "query") && (
            <Form form={form} layout="inline" style={{ marginBottom: 8 }}>
              {api.params
                .filter((p) => p.location === "query")
                .map((p) => (
                  <Form.Item key={p.name} label={p.name} name={p.name}>
                    <Input placeholder={p.desc} style={{ width: 240 }} />
                  </Form.Item>
                ))}
            </Form>
          )}
          {api.params.some((p) => p.location === "body") && (
            <div style={{ border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
              <Editor
                height="120px"
                defaultLanguage="json"
                value={bodyValue}
                onChange={(v) => setBodyValue(v || "")}
                options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, lineNumbers: "off" }}
              />
            </div>
          )}
        </Card>
      )}

      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<SendOutlined />} onClick={handleSend} loading={loading}>
          发送请求
        </Button>
      </Space>

      {(response || statusCode !== null) && (
        <Card
          size="small"
          title={
            <Space>
              <Text strong>响应结果</Text>
              {statusCode !== null && (
                <Tag color={statusCode >= 200 && statusCode < 300 ? "success" : "error"}>
                  HTTP {statusCode}
                </Tag>
              )}
            </Space>
          }
        >
          <pre
            style={{
              background: "#1e1e1e",
              color: "#d4d4d4",
              padding: 12,
              borderRadius: 4,
              maxHeight: 300,
              overflow: "auto",
              fontSize: 13,
              margin: 0,
            }}
          >
            {response}
          </pre>
        </Card>
      )}
    </div>
  );
}

export default function ApiPlayground() {
  const items = apiList.map((api) => ({
    key: api.key,
    label: (
      <Space>
        <Tag color={api.method === "GET" ? "green" : "blue"}>{api.method}</Tag>
        <Text strong>{api.path}</Text>
        <Text type="secondary"> — {api.description.split("—")[0]}</Text>
      </Space>
    ),
    children: <ApiPanel api={api} />,
  }));

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        API 接口说明与调试
      </Title>
      <Paragraph type="secondary">
        以下为提供给移动端的 3 个接口。点击展开可查看文档并在线测试，签名 (x-sign) 会自动计算注入。
      </Paragraph>
      <Collapse accordion items={items} />
    </div>
  );
}
