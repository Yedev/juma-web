import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, InputNumber, Spin, Table, Tag, message } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface AnalyticsUser {
  id: number;
  phone: string;
  nickname: string;
}

interface AnalyticsEventRecord {
  id: number;
  eventId: string;
  userId: number | null;
  eventName: string;
  eventTime: string;
  platform: string;
  page: string;
  sessionId: string;
  deviceId: string;
  properties: string;
  rawPayload: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  user: AnalyticsUser | null;
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function AnalyticsEventManagement() {
  const [events, setEvents] = useState<AnalyticsEventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [eventName, setEventName] = useState("");
  const [userId, setUserId] = useState<number | null>(null);
  const [eventPage, setEventPage] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    eventName: "",
    userId: null as number | null,
    eventPage: "",
    sessionId: "",
    startAt: "",
    endAt: "",
  });

  const params = useMemo(
    () => ({
      page,
      pageSize: 20,
      eventName: appliedFilters.eventName.trim() || undefined,
      userId: appliedFilters.userId ?? undefined,
      eventPage: appliedFilters.eventPage.trim() || undefined,
      sessionId: appliedFilters.sessionId.trim() || undefined,
      startAt: appliedFilters.startAt.trim() || undefined,
      endAt: appliedFilters.endAt.trim() || undefined,
    }),
    [page, appliedFilters],
  );

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminClient.get("/api/admin/analytics/events", { params });
      if (res.data.code === 200) {
        setEvents(res.data.data.list);
        setTotal(res.data.data.total);
      }
    } catch {
      message.error("加载埋点事件失败");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const applyFilters = () => {
    setAppliedFilters({
      eventName,
      userId,
      eventPage,
      sessionId,
      startAt,
      endAt,
    });
    setPage(1);
  };

  const resetFilters = () => {
    setEventName("");
    setUserId(null);
    setEventPage("");
    setSessionId("");
    setStartAt("");
    setEndAt("");
    setAppliedFilters({
      eventName: "",
      userId: null,
      eventPage: "",
      sessionId: "",
      startAt: "",
      endAt: "",
    });
    setPage(1);
  };

  const columns = [
    {
      title: "事件时间",
      dataIndex: "eventTime",
      key: "eventTime",
      width: 170,
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
    {
      title: "事件名",
      dataIndex: "eventName",
      key: "eventName",
      width: 180,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: "用户",
      key: "user",
      width: 170,
      render: (_: unknown, record: AnalyticsEventRecord) =>
        record.user ? (
          <div>
            <div>{record.user.nickname || "未命名用户"}</div>
            <div style={{ fontSize: 12, color: "#999", fontFamily: "monospace" }}>{record.user.phone}</div>
          </div>
        ) : (
          <span style={{ color: "#999" }}>匿名</span>
        ),
    },
    {
      title: "平台",
      dataIndex: "platform",
      key: "platform",
      width: 100,
      render: (value: string) => value || <span style={{ color: "#bbb" }}>-</span>,
    },
    {
      title: "页面",
      dataIndex: "page",
      key: "page",
      width: 160,
      render: (value: string) => value || <span style={{ color: "#bbb" }}>-</span>,
    },
    {
      title: "Session",
      dataIndex: "sessionId",
      key: "sessionId",
      width: 180,
      render: (value: string) =>
        value ? <span style={{ fontFamily: "monospace", fontSize: 12 }}>{value}</span> : <span style={{ color: "#bbb" }}>-</span>,
    },
    {
      title: "Device",
      dataIndex: "deviceId",
      key: "deviceId",
      width: 180,
      render: (value: string) =>
        value ? <span style={{ fontFamily: "monospace", fontSize: 12 }}>{value}</span> : <span style={{ color: "#bbb" }}>-</span>,
    },
    {
      title: "属性摘要",
      dataIndex: "properties",
      key: "properties",
      render: (value: string) => (
        <pre
          style={{
            margin: 0,
            fontSize: 11,
            maxHeight: 72,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {prettyJson(value)}
        </pre>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "#999" }}>查看客户端上报的分析埋点事件，支持匿名与带 DeepRead 用户身份的事件。</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          <Input placeholder="事件名，例如 article_open" value={eventName} onChange={(e) => setEventName(e.target.value)} />
          <InputNumber
            style={{ width: "100%" }}
            min={1}
            placeholder="用户 ID"
            value={userId}
            onChange={(value) => setUserId(typeof value === "number" ? value : null)}
          />
          <Input placeholder="页面，例如 article_detail" value={eventPage} onChange={(e) => setEventPage(e.target.value)} />
          <Input placeholder="Session ID" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          <Input placeholder="开始时间 ISO，例如 2026-04-15T00:00:00.000Z" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          <Input placeholder="结束时间 ISO，例如 2026-04-15T23:59:59.999Z" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button type="primary" icon={<SearchOutlined />} onClick={applyFilters}>
            查询
          </Button>
          <Button onClick={resetFilters}>重置</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchEvents()}>
            刷新
          </Button>
          <span style={{ fontSize: 12, color: "#999" }}>共 {total} 条</span>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : (
        <Table
          dataSource={events}
          columns={columns}
          rowKey="id"
          size="small"
          scroll={{ x: 1300 }}
          expandable={{
            expandedRowRender: (record: AnalyticsEventRecord) => (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                    事件元信息
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.8, color: "#666" }}>
                    <div><strong>eventId:</strong> <span style={{ fontFamily: "monospace" }}>{record.eventId}</span></div>
                    <div><strong>createdAt:</strong> {new Date(record.createdAt).toLocaleString("zh-CN")}</div>
                    <div><strong>IP:</strong> {record.ip || "-"}</div>
                    <div><strong>User-Agent:</strong> {record.userAgent || "-"}</div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                    原始事件载荷
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      background: "#f5f5f5",
                      padding: 10,
                      borderRadius: 4,
                      fontSize: 11,
                      maxHeight: 260,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {prettyJson(record.rawPayload)}
                  </pre>
                </div>
              </div>
            ),
          }}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: (nextPage) => setPage(nextPage),
            showTotal: (value) => `共 ${value} 条`,
            size: "small",
          }}
        />
      )}
    </div>
  );
}
