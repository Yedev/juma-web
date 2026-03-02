import { useState, useEffect, useCallback } from "react";
import { Table, Tag, Tooltip, Modal, Input, Select, message, Popconfirm } from "antd";
import {
  ReloadOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  LinkOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { adminClient } from "../api/client";

const { TextArea } = Input;

const taskStatuses = ["queued", "running", "error", "completed"] as const;
type TaskStatus = (typeof taskStatuses)[number];

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

const statusDefs: Record<TaskStatus, StatusDef> = {
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

function isTaskStatus(status: string): status is TaskStatus {
  return taskStatuses.includes(status as TaskStatus);
}

function parseInfo(raw: string): StatusInfo {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseJsonObject(
  raw: string,
  fieldLabel: string
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, message: `${fieldLabel} 必须是 JSON 对象` };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: `${fieldLabel} JSON 格式不合法` };
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  const maybeError = error as { response?: { data?: { message?: string } } };
  return maybeError.response?.data?.message || fallback;
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
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createTaskName, setCreateTaskName] = useState("");
  const [createTaskParams, setCreateTaskParams] = useState("{\n  \n}");
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [editingStatus, setEditingStatus] = useState<TaskStatus>("queued");
  const [editingStatusInfo, setEditingStatusInfo] = useState("{\n  \n}");

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

  const refreshPage = useCallback(
    (targetPage: number = page) => {
      fetchTasks(targetPage);
    },
    [page, fetchTasks]
  );

  useEffect(() => {
    fetchTasks(page);
  }, [page, fetchTasks]);

  const openCreateModal = () => {
    setCreateTaskName("");
    setCreateTaskParams("{\n  \n}");
    setCreateOpen(true);
  };

  const handleCreateTask = async () => {
    const taskName = createTaskName.trim();
    if (!taskName) {
      message.error("请输入任务名称");
      return;
    }

    const parsed = parseJsonObject(createTaskParams, "任务参数");
    if (!parsed.ok) {
      message.error(parsed.message);
      return;
    }

    setCreating(true);
    try {
      const res = await adminClient.post("/api/admin/tasks", {
        taskName,
        taskParams: parsed.value,
      });
      if (res.data.code === 200) {
        message.success("任务已创建");
        setCreateOpen(false);
        if (page !== 1) {
          setPage(1);
        }
        fetchTasks(1);
      }
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "创建任务失败"));
    } finally {
      setCreating(false);
    }
  };

  const openStatusModal = (record: TaskRecord) => {
    setEditingTask(record);
    setEditingStatus(isTaskStatus(record.status) ? record.status : "queued");
    setEditingStatusInfo(JSON.stringify(parseInfo(record.statusInfo), null, 2));
    setStatusOpen(true);
  };

  const handleUpdateStatus = async () => {
    if (!editingTask) return;

    const parsed = parseJsonObject(editingStatusInfo, "状态附加信息");
    if (!parsed.ok) {
      message.error(parsed.message);
      return;
    }

    setStatusSaving(true);
    try {
      const res = await adminClient.put(
        `/api/admin/tasks/${encodeURIComponent(editingTask.taskId)}/status`,
        {
          status: editingStatus,
          statusInfo: parsed.value,
        }
      );
      if (res.data.code === 200) {
        message.success("任务状态已更新");
        setStatusOpen(false);
        refreshPage();
      }
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "更新任务状态失败"));
    } finally {
      setStatusSaving(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const res = await adminClient.delete(`/api/admin/tasks/${encodeURIComponent(taskId)}`);
      if (res.data.code === 200) {
        message.success("任务已删除");
        const targetPage = page > 1 && tasks.length === 1 ? page - 1 : page;
        if (targetPage !== page) {
          setPage(targetPage);
          fetchTasks(targetPage);
        } else {
          refreshPage();
        }
      }
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "删除任务失败"));
    }
  };

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
        const normalized = isTaskStatus(status) ? status : "queued";
        const def = statusDefs[normalized];
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
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 160,
      render: (t: string) => (
        <span style={{ color: "#999", fontSize: 12 }}>
          {new Date(t).toLocaleString("zh-CN")}
        </span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_: unknown, record: TaskRecord) => (
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            onClick={() => openStatusModal(record)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "#666",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#333")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#666")}
          >
            <EditOutlined style={{ fontSize: 11 }} />
            更新状态
          </span>
          <Popconfirm
            title="确认删除任务？"
            description={`任务ID: ${record.taskId}`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDeleteTask(record.taskId)}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "#999",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ff4d4f")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#999")}
            >
              <DeleteOutlined style={{ fontSize: 11 }} />
              删除
            </span>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 12, color: "#999" }}>可在此直接创建任务、修改状态、删除任务</span>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            onClick={openCreateModal}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "#666",
              cursor: "pointer",
              padding: "4px 0",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#333")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#666")}
          >
            <PlusOutlined style={{ fontSize: 12 }} />
            新建任务
          </span>
          <span
            onClick={() => refreshPage()}
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

      <Modal
        title="新建任务"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreateTask}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>任务名称</div>
            <Input
              value={createTaskName}
              onChange={(e) => setCreateTaskName(e.target.value)}
              placeholder="例如：数据分析任务"
              maxLength={100}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>任务参数 (JSON 对象)</div>
            <TextArea
              value={createTaskParams}
              onChange={(e) => setCreateTaskParams(e.target.value)}
              autoSize={{ minRows: 5, maxRows: 10 }}
              style={{ fontFamily: "'SF Mono', monospace", fontSize: 12 }}
            />
          </div>
        </div>
      </Modal>

      <Modal
        title={editingTask ? `更新状态 · ${editingTask.taskId}` : "更新状态"}
        open={statusOpen}
        onCancel={() => setStatusOpen(false)}
        onOk={handleUpdateStatus}
        confirmLoading={statusSaving}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>任务状态</div>
            <Select
              value={editingStatus}
              style={{ width: "100%" }}
              onChange={(v) => setEditingStatus(v)}
              options={taskStatuses.map((status) => ({
                value: status,
                label: statusDefs[status].text,
              }))}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
              状态附加信息 status_info (JSON 对象)
            </div>
            <TextArea
              value={editingStatusInfo}
              onChange={(e) => setEditingStatusInfo(e.target.value)}
              autoSize={{ minRows: 6, maxRows: 12 }}
              style={{ fontFamily: "'SF Mono', monospace", fontSize: 12 }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
