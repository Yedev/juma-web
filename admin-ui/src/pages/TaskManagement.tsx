import { useState, useEffect, useCallback, useMemo } from "react";
import { Table, Tag, Tooltip, Modal, Input, Select, InputNumber, message, Popconfirm } from "antd";
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
const taskTypes = ["server_script", "remote_mac"] as const;
type TaskType = (typeof taskTypes)[number];

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
  executor?: string;
  client_id?: string;
  timeout?: boolean;
  [key: string]: unknown;
}

interface TaskRecord {
  id: number;
  taskId: string;
  taskName: string;
  taskType: string;
  targetClientId?: string | null;
  claimedByClientId?: string | null;
  taskParams: string;
  status: string;
  statusInfo: string;
  executionLog: string;
  resultCode?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  maxRetries: number;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

interface TaskParams {
  script?: string;
  timeout_sec?: number;
  env?: Record<string, unknown>;
  cwd?: string;
  required_tags?: string[];
  [key: string]: unknown;
}

interface ExecutorClient {
  clientId: string;
  name: string;
  platform: string;
  appVersion: string;
  tags: string[];
  status: string;
  ip?: string;
  lastHeartbeat: string;
  tasksClaimed: number;
  tasksSuccess: number;
  tasksFailed: number;
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

function isTaskType(taskType: string): taskType is TaskType {
  return taskTypes.includes(taskType as TaskType);
}

function parseInfo(raw: string): StatusInfo {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseTaskParams(raw: string): TaskParams {
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

function taskTypeText(taskType: TaskType): string {
  return taskType === "server_script" ? "服务器执行" : "Mac Mini 执行";
}

function taskTypeColor(taskType: TaskType): string {
  return taskType === "server_script" ? "#722ed1" : "#1677ff";
}

function StatusExtra({ status, info }: { status: string; info: StatusInfo }) {
  if (status === "running" && info.executor === "remote_mac" && info.client_id) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#1677ff", fontSize: 11 }}>客户端 {info.client_id} 执行中</span>
      </div>
    );
  }

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
  const [clients, setClients] = useState<ExecutorClient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createTaskName, setCreateTaskName] = useState("");
  const [createTaskType, setCreateTaskType] = useState<TaskType>("server_script");
  const [createScript, setCreateScript] = useState("echo \"hello from task executor\"");
  const [createTimeoutSec, setCreateTimeoutSec] = useState(300);
  const [createEnv, setCreateEnv] = useState("{\n  \n}");
  const [createCwd, setCreateCwd] = useState("");
  const [createTargetClientId, setCreateTargetClientId] = useState<string | undefined>(undefined);
  const [createRequiredTags, setCreateRequiredTags] = useState<string[]>([]);
  const [createMaxRetries, setCreateMaxRetries] = useState(0);
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

  const fetchClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const res = await adminClient.get("/api/admin/executor/clients");
      if (res.data.code === 200) {
        setClients(res.data.data);
      }
    } catch {
      // handled by interceptor
    } finally {
      setClientsLoading(false);
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

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const openCreateModal = () => {
    setCreateTaskName("");
    setCreateTaskType("server_script");
    setCreateScript("echo \"hello from task executor\"");
    setCreateTimeoutSec(300);
    setCreateEnv("{\n  \n}");
    setCreateCwd("");
    setCreateTargetClientId(undefined);
    setCreateRequiredTags([]);
    setCreateMaxRetries(0);
    fetchClients();
    setCreateOpen(true);
  };

  const handleCreateTask = async () => {
    const taskName = createTaskName.trim();
    if (!taskName) {
      message.error("请输入任务名称");
      return;
    }

    if (!createScript.trim()) {
      message.error("请输入执行脚本");
      return;
    }

    const envResult = parseJsonObject(createEnv, "环境变量 env");
    if (!envResult.ok) {
      message.error(envResult.message);
      return;
    }

    if (createTaskType === "remote_mac" && createTargetClientId && !clients.some((c) => c.clientId === createTargetClientId)) {
      message.error("目标客户端不存在，请刷新后重试");
      return;
    }

    setCreating(true);
    try {
      const res = await adminClient.post("/api/admin/tasks", {
        taskName,
        taskType: createTaskType,
        script: createScript,
        timeoutSec: createTimeoutSec,
        env: envResult.value,
        cwd: createCwd || undefined,
        targetClientId: createTaskType === "remote_mac" ? createTargetClientId : undefined,
        requiredTags: createTaskType === "remote_mac" ? createRequiredTags : [],
        maxRetries: createMaxRetries,
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

  const handleDeleteClient = async (clientId: string) => {
    try {
      const res = await adminClient.delete(`/api/admin/executor/clients/${encodeURIComponent(clientId)}`);
      if (res.data.code === 200) {
        message.success("客户端记录已删除");
        fetchClients();
      }
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "删除客户端失败"));
    }
  };

  const clientOptions = useMemo(
    () =>
      clients.map((client) => ({
        value: client.clientId,
        label: `${client.name} (${client.clientId})`,
      })),
    [clients]
  );

  const columns = [
    {
      title: "任务ID",
      dataIndex: "taskId",
      key: "taskId",
      width: 170,
      render: (text: string) => (
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{text}</span>
      ),
    },
    {
      title: "类型",
      dataIndex: "taskType",
      key: "taskType",
      width: 130,
      render: (taskType: string) => {
        const normalized = isTaskType(taskType) ? taskType : "server_script";
        return (
          <Tag
            style={{
              border: "none",
              borderRadius: 4,
              background: "#fafafa",
              color: taskTypeColor(normalized),
              fontSize: 12,
            }}
          >
            {taskTypeText(normalized)}
          </Tag>
        );
      },
    },
    {
      title: "任务名称",
      dataIndex: "taskName",
      key: "taskName",
      width: 140,
    },
    {
      title: "脚本",
      key: "script",
      width: 220,
      ellipsis: true,
      render: (_: unknown, record: TaskRecord) => {
        const params = parseTaskParams(record.taskParams);
        const script = typeof params.script === "string" ? params.script : "";
        if (!script) return <span style={{ color: "#bbb", fontSize: 12 }}>-</span>;
        return (
          <Tooltip title={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{script}</pre>}>
            <span style={{ color: "#666", fontSize: 12 }}>
              {script.split("\n")[0]}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: "执行节点",
      key: "executor",
      width: 170,
      render: (_: unknown, record: TaskRecord) => {
        const normalizedType = isTaskType(record.taskType) ? record.taskType : "server_script";
        if (normalizedType === "server_script") {
          return <span style={{ color: "#666", fontSize: 12 }}>server-local</span>;
        }
        const target = record.targetClientId || "任意在线客户端";
        const claimed = record.claimedByClientId ? ` / 已分配: ${record.claimedByClientId}` : "";
        return (
          <Tooltip title={`目标: ${target}${claimed}`}>
            <span style={{ color: "#666", fontSize: 12 }}>
              {record.claimedByClientId || target}
            </span>
          </Tooltip>
        );
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
      width: 220,
      render: (_: unknown, record: TaskRecord) => {
        const info = parseInfo(record.statusInfo);
        return <StatusExtra status={record.status} info={info} />;
      },
    },
    {
      title: "日志",
      key: "executionLog",
      width: 120,
      render: (_: unknown, record: TaskRecord) =>
        record.executionLog ? (
          <Tooltip
            title={
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", maxWidth: 500 }}>
                {record.executionLog}
              </pre>
            }
            placement="topLeft"
          >
            <span style={{ fontSize: 12, color: "#1677ff", cursor: "pointer" }}>查看日志</span>
          </Tooltip>
        ) : (
          <span style={{ fontSize: 12, color: "#bbb" }}>-</span>
        ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 150,
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
      width: 150,
      render: (t: string) => (
        <span style={{ color: "#999", fontSize: 12 }}>
          {new Date(t).toLocaleString("zh-CN")}
        </span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
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

  const clientColumns = [
    {
      title: "客户端ID",
      dataIndex: "clientId",
      key: "clientId",
      width: 180,
      render: (text: string) => (
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{text}</span>
      ),
    },
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: 140,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => (
        <Tag color={status === "online" ? "green" : "default"} style={{ fontSize: 12 }}>
          {status === "online" ? "在线" : "离线"}
        </Tag>
      ),
    },
    {
      title: "平台",
      key: "platform",
      width: 120,
      render: (_: unknown, record: ExecutorClient) => (
        <span style={{ color: "#666", fontSize: 12 }}>
          {record.platform} · {record.appVersion}
        </span>
      ),
    },
    {
      title: "标签",
      dataIndex: "tags",
      key: "tags",
      width: 170,
      render: (tags: string[]) =>
        tags.length ? (
          <span style={{ color: "#666", fontSize: 12 }}>{tags.join(", ")}</span>
        ) : (
          <span style={{ color: "#bbb", fontSize: 12 }}>-</span>
        ),
    },
    {
      title: "最近心跳",
      dataIndex: "lastHeartbeat",
      key: "lastHeartbeat",
      width: 160,
      render: (t: string) => (
        <span style={{ color: "#999", fontSize: 12 }}>
          {new Date(t).toLocaleString("zh-CN")}
        </span>
      ),
    },
    {
      title: "任务统计",
      key: "stats",
      width: 180,
      render: (_: unknown, record: ExecutorClient) => (
        <span style={{ color: "#999", fontSize: 12 }}>
          领取 {record.tasksClaimed} / 成功 {record.tasksSuccess} / 失败 {record.tasksFailed}
        </span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      render: (_: unknown, record: ExecutorClient) => (
        <Popconfirm
          title="删除客户端记录？"
          description={`客户端 ${record.clientId}`}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => handleDeleteClient(record.clientId)}
        >
          <span style={{ fontSize: 12, color: "#999", cursor: "pointer" }}>删除</span>
        </Popconfirm>
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
        <span style={{ fontSize: 12, color: "#999" }}>
          支持两类任务：服务器本地执行（server_script） / 分发到 Mac Mini 客户端（remote_mac）
        </span>
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
          <span
            onClick={fetchClients}
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
            刷新客户端
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
        scroll={{ x: 1620 }}
      />

      <div style={{ marginTop: 22, marginBottom: 10, fontSize: 13, fontWeight: 500, color: "#333" }}>
        执行客户端状态
      </div>
      <Table
        columns={clientColumns}
        dataSource={clients}
        rowKey="clientId"
        loading={clientsLoading}
        size="small"
        pagination={false}
        scroll={{ x: 1140 }}
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
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>任务类型</div>
            <Select
              value={createTaskType}
              onChange={(value) => setCreateTaskType(value)}
              options={[
                { value: "server_script", label: "服务器执行 (server_script)" },
                { value: "remote_mac", label: "分发到 Mac Mini 客户端执行 (remote_mac)" },
              ]}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>执行脚本</div>
            <TextArea
              value={createScript}
              onChange={(e) => setCreateScript(e.target.value)}
              autoSize={{ minRows: 5, maxRows: 10 }}
              style={{ fontFamily: "'SF Mono', monospace", fontSize: 12 }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>超时(秒)</div>
              <InputNumber
                min={1}
                max={3600}
                style={{ width: "100%" }}
                value={createTimeoutSec}
                onChange={(value) => setCreateTimeoutSec(value || 300)}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>最大重试次数</div>
              <InputNumber
                min={0}
                max={10}
                style={{ width: "100%" }}
                value={createMaxRetries}
                onChange={(value) => setCreateMaxRetries(value || 0)}
              />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>工作目录（可选）</div>
            <Input
              value={createCwd}
              onChange={(e) => setCreateCwd(e.target.value)}
              placeholder="例如：/Users/runner/workspace"
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>环境变量 env (JSON 对象)</div>
            <TextArea
              value={createEnv}
              onChange={(e) => setCreateEnv(e.target.value)}
              autoSize={{ minRows: 4, maxRows: 8 }}
              style={{ fontFamily: "'SF Mono', monospace", fontSize: 12 }}
            />
          </div>
          {createTaskType === "remote_mac" && (
            <>
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>目标客户端（可选）</div>
                <Select
                  allowClear
                  value={createTargetClientId}
                  options={clientOptions}
                  onChange={(value) => setCreateTargetClientId(value)}
                  placeholder="不指定则由任意匹配客户端领取"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>required_tags（可选）</div>
                <Select
                  mode="tags"
                  style={{ width: "100%" }}
                  value={createRequiredTags}
                  onChange={(values) => setCreateRequiredTags(values)}
                  placeholder="例如: xcode,ios,android"
                  tokenSeparators={[",", " "]}
                />
              </div>
            </>
          )}
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
