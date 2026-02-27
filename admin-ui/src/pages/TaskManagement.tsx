import { useState, useEffect, useCallback } from "react";
import { Table, Button, Tag, Typography, Space } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

const { Title } = Typography;

interface TaskRecord {
  id: number;
  taskId: string;
  taskName: string;
  taskParams: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const statusColorMap: Record<string, string> = {
  pending: "default",
  running: "processing",
  success: "success",
  failed: "error",
};

const statusTextMap: Record<string, string> = {
  pending: "等待中",
  running: "执行中",
  success: "成功",
  failed: "失败",
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
    { title: "任务ID", dataIndex: "taskId", key: "taskId", width: 180 },
    { title: "任务名称", dataIndex: "taskName", key: "taskName" },
    {
      title: "任务参数",
      dataIndex: "taskParams",
      key: "taskParams",
      ellipsis: true,
      render: (text: string) => {
        try {
          return JSON.stringify(JSON.parse(text));
        } catch {
          return text;
        }
      },
    },
    {
      title: "执行状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => (
        <Tag color={statusColorMap[status] || "default"}>
          {statusTextMap[status] || status}
        </Tag>
      ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (t: string) => new Date(t).toLocaleString("zh-CN"),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (t: string) => new Date(t).toLocaleString("zh-CN"),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <Title level={4} style={{ margin: 0 }}>
          任务管理
        </Title>
        <Button icon={<ReloadOutlined />} onClick={() => fetchTasks(page)}>
          刷新列表
        </Button>
      </Space>
      <Table
        columns={columns}
        dataSource={tasks}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => setPage(p),
          showTotal: (t) => `共 ${t} 条`,
        }}
      />
    </div>
  );
}
