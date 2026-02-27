import { useState, useEffect, useCallback } from "react";
import { Table, Tag, Tooltip } from "antd";
import {
  ReloadOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import { adminClient } from "../api/client";

interface StatusInfo {
  queue_position?: number;
  current_step?: string;
  progress?: number;
  error?: string;
  error_code?: string;
  failed_at_step?: string;
  output_url?: string;
  file_size?: string;
  rows?: number;
  count?: number;
  [key: string]: unknown;
}

interface TaskRecord {
  id: number;
  taskId: string;
  taskName: string;
  taskParams: string;
  status: string;
  statusInfo: string;
  createdAt: string;
  updatedAt: string;
}

interface StatusDef {
  color: string;
  bg: string;
  text: string;
  icon: React.ReactNode;
}

const statusDefs: Record<string, StatusDef> = {
  queued: {
    color: "#999",
    bg: "#f5f5f5",
    text: "排队中",
    icon: <ClockCircleOutlined style={{ fontSize: 11 }} />,
  },
  running: {
    color: "#1890ff",
    bg: "#e6f7ff",
    text: "执行中",
    icon: <SyncOutlined spin style={{ fontSize: 11 }} />,
  },
  error: {
    color: "#ff4d4f",
    bg: "#fff1f0",
    text: "执行错误",
    icon: <CloseCircleOutlined style={{ fontSize: 11 }} />,
  },
  completed: {
    color: "#52c41a",
    bg: "#f6ffed",
    text: "执行完成",
    icon: <CheckCircleOutlined style={{ fontSize: 11 }} />,
  },
};

function parseInfo(raw: string): StatusInfo {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function StatusExtra({ status, info }: { status: string; info: StatusInfo }) {
  if (status === "queued" && info.queue_position != null) {
    return (
      <span style={{ color: "#bbb", fontSize: 11 }}>
        前方排队 {info.queue_position} 个
      </span>
    );
  }

  if (status === "running" && info.current_step) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#1890ff", fontSize: 11 }}>{info.current_step}</span>
        {info.progress != null && (
          <div
            style={{
              width: 48,
              height: 4,
              background: "#e8e8e8",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${info.progress}%`,
                height: "100%",
                background: "#1890ff",
                borderRadius: 2,
                transition: "width 0.3s",
              }}
            />
          </div>
        )}
      </div>
    );
  }

  if (status === "error" && info.error) {
    return (
      <Tooltip title={info.error} placement="topLeft">
        <span
          style={{
            color: "#ff7875",
            fontSize: 11,
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "inline-block",
            cursor: "default",
          }}
        >
          {info.error}
        </span>
      </Tooltip>
    );
  }

  if (status === "completed" && info.output_url) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
        <a
          href={info.output_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#52c41a", display: "inline-flex", alignItems: "center", gap: 3 }}
        >
          <LinkOutlined style={{ fontSize: 10 }} />
          产物
        </a>
        {info.file_size && <span style={{ color: "#bbb" }}>{info.file_size}</span>}
        {info.rows != null && <span style={{ color: "#bbb" }}>{info.rows} 行</span>}
        {info.count != null && <span style={{ color: "#bbb" }}>{info.count} 个</span>}
      </div>
    );
  }

  return null;
}

export default function TaskManagement() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await adminClient.get("/api/admin/tasks", {
        params: { page: p, pageSize: 20 },
      });
      if (res.data.code === 200) {
        setTasks(res.data.data.list);
        setTotal(res.data.data.total);
      }
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks(page);
  }, [page, fetchTasks]);

  const columns = [
    {
      title: "任务ID",
      dataIndex: "taskId",
      key: "taskId",
      width: 180,
      render: (text: string) => (
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{text}</span>
      ),
    },
    {
      title: "任务名称",
      dataIndex: "taskName",
      key: "taskName",
      width: 160,
    },
    {
      title: "任务参数",
      dataIndex: "taskParams",
      key: "taskParams",
      width: 180,
      ellipsis: true,
      render: (text: string) => {
        try {
          return (
            <span style={{ color: "#999", fontSize: 12 }}>
              {JSON.stringify(JSON.parse(text))}
            </span>
          );
        } catch {
          return <span style={{ color: "#999", fontSize: 12 }}>{text}</span>;
        }
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => {
        const def = statusDefs[status] || statusDefs.queued;
        return (
          <Tag
            icon={def.icon}
            style={{
              background: def.bg,
              color: def.color,
              border: "none",
              fontSize: 12,
              borderRadius: 3,
              padding: "2px 8px",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {def.text}
          </Tag>
        );
      },
    },
    {
      title: "详情",
      key: "statusDetail",
      width: 240,
      render: (_: unknown, record: TaskRecord) => {
        const info = parseInfo(record.statusInfo);
        return <StatusExtra status={record.status} info={info} />;
      },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (t: string) => (
        <span style={{ color: "#999", fontSize: 12 }}>
          {new Date(t).toLocaleString("zh-CN")}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          marginBottom: 16,
        }}
      >
        <span
          onClick={() => fetchTasks(page)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#999",
            cursor: "pointer",
            padding: "4px 0",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#333")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#999")}
        >
          <ReloadOutlined style={{ fontSize: 12 }} />
          刷新列表
        </span>
      </div>

      <Table
        columns={columns}
        dataSource={tasks}
        rowKey="id"
        loading={loading}
        size="middle"
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => setPage(p),
          showTotal: (t) => <span style={{ fontSize: 12, color: "#999" }}>共 {t} 条</span>,
          size: "small",
        }}
      />
    </div>
  );
}
