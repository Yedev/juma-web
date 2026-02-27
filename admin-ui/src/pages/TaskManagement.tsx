import { useState, useEffect, useCallback } from "react";
import { Table, Tag } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface TaskRecord {
  id: number;
  taskId: string;
  taskName: string;
  taskParams: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const statusStyle: Record<string, { bg: string; color: string; text: string }> = {
  pending: { bg: "#f5f5f5", color: "#999", text: "等待中" },
  running: { bg: "#e6f7ff", color: "#1890ff", text: "执行中" },
  success: { bg: "#f0fff0", color: "#52c41a", text: "成功" },
  failed: { bg: "#fff1f0", color: "#ff4d4f", text: "失败" },
};

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
      width: 190,
      render: (text: string) => (
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{text}</span>
      ),
    },
    { title: "任务名称", dataIndex: "taskName", key: "taskName" },
    {
      title: "任务参数",
      dataIndex: "taskParams",
      key: "taskParams",
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
      title: "执行状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (status: string) => {
        const s = statusStyle[status] || statusStyle.pending;
        return (
          <Tag
            style={{
              background: s.bg,
              color: s.color,
              border: "none",
              fontSize: 12,
              borderRadius: 3,
              padding: "1px 8px",
            }}
          >
            {s.text}
          </Tag>
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (t: string) => (
        <span style={{ color: "#999", fontSize: 12 }}>
          {new Date(t).toLocaleString("zh-CN")}
        </span>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 170,
      render: (t: string) => (
        <span style={{ color: "#999", fontSize: 12 }}>
          {new Date(t).toLocaleString("zh-CN")}
        </span>
      ),
    },
  ];

  return (
    <div>
      {/* Toolbar */}
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
