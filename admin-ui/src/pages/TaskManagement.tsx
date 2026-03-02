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
  PlayCircleOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { adminClient } from "../api/client";

const { TextArea } = Input;

const taskStatuses = ["queued", "running", "error", "completed"] as const;
type TaskStatus = (typeof taskStatuses)[number];
const taskTypes = ["server_task", "client_task"] as const;
type TaskType = (typeof taskTypes)[number];

interface StatusInfo {
  queue_position?: number;
  current_step?: string;
  progress?: number;
  error?: string;
  error_code?: string;
  failed_at_step?: string;
  output_url?: string;
  output_json?: unknown;
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
  task_payload?: Record<string, unknown>;
  execution_name?: string;
  required_tags?: string[];
  taskPayload?: Record<string, unknown>;
  executionName?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ServiceDef {
  name: string;
  version?: string;
  description?: string;
}

interface ExecutorClient {
  clientId: string;
  name: string;
  platform: string;
  appVersion: string;
  tags: string[];
  services: ServiceDef[];
  status: string;
  ip?: string;
  lastHeartbeat: string;
  tasksClaimed: number;
  tasksSuccess: number;
  tasksFailed: number;
}

interface RegisteredTaskParamDef {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: unknown;
}

interface RegisteredTaskDef {
  taskName: string;
  title: string;
  description: string;
  taskType: TaskType;
  executeMode: "script" | "service";
  serviceName?: string;
  params: RegisteredTaskParamDef[];
  exampleTaskParams: Record<string, unknown>;
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

function parseJsonAny(raw: string, fieldLabel: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, message: `${fieldLabel} JSON 格式不合法` };
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

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function taskTypeText(taskType: TaskType): string {
  return taskType === "server_task" ? "服务器执行" : "客户端执行";
}

function taskTypeColor(taskType: TaskType): string {
  return taskType === "server_task" ? "#722ed1" : "#1677ff";
}

function StatusExtra({ status, info }: { status: string; info: StatusInfo }) {
  if (status === "running" && info.executor === "client_task_runtime" && info.client_id) {
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

  if (status === "completed" && info.output_json) {
    return (
      <Tooltip
        placement="topLeft"
        title={
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", maxWidth: 420 }}>
            {JSON.stringify(info.output_json, null, 2)}
          </pre>
        }
      >
        <span style={{ color: "#52c41a", fontSize: 11, cursor: "pointer" }}>查看服务返回 JSON</span>
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
  type RemoteMode = "script" | "service";

  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [clients, setClients] = useState<ExecutorClient[]>([]);
  const [taskDefinitions, setTaskDefinitions] = useState<RegisteredTaskDef[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [triggeringTaskName, setTriggeringTaskName] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createTaskName, setCreateTaskName] = useState("");
  const [createTaskType, setCreateTaskType] = useState<TaskType>("server_task");
  const [createRemoteMode, setCreateRemoteMode] = useState<RemoteMode>("script");
  const [createScript, setCreateScript] = useState("echo \"hello from task executor\"");
  const [createServiceName, setCreateServiceName] = useState("demo.mock3s");
  const [createServicePayload, setCreateServicePayload] = useState("{\n  \"demo\": true\n}");
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
  const [logOpen, setLogOpen] = useState(false);
  const [logTask, setLogTask] = useState<TaskRecord | null>(null);

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

  const fetchTaskDefinitions = useCallback(async () => {
    setDefinitionsLoading(true);
    try {
      const res = await adminClient.get("/api/admin/task-definitions");
      if (res.data.code === 200) {
        setTaskDefinitions(res.data.data.list || []);
      }
    } catch {
      // handled by interceptor
    } finally {
      setDefinitionsLoading(false);
    }
  }, []);

  const handleExecuteRegisteredTask = useCallback(
    async (definition: RegisteredTaskDef) => {
      setTriggeringTaskName(definition.taskName);
      try {
        const res = await adminClient.post("/api/admin/tasks/execute-by-name", {
          taskName: definition.taskName,
          taskParams: definition.exampleTaskParams,
        });
        if (res.data.code === 200) {
          message.success(`已触发示例任务：${definition.taskName}`);
          if (page !== 1) {
            setPage(1);
          }
          fetchTasks(1);
        }
      } catch (error: unknown) {
        message.error(getErrorMessage(error, "触发示例任务失败"));
      } finally {
        setTriggeringTaskName(null);
      }
    },
    [fetchTasks, page]
  );

  const openLogModal = useCallback((record: TaskRecord) => {
    setLogTask(record);
    setLogOpen(true);
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

  useEffect(() => {
    fetchTaskDefinitions();
  }, [fetchTaskDefinitions]);

  const openCreateModal = () => {
    setCreateTaskName("");
    setCreateTaskType("server_task");
    setCreateRemoteMode("script");
    setCreateScript("echo \"hello from task executor\"");
    setCreateServiceName("demo.mock3s");
    setCreateServicePayload("{\n  \"demo\": true\n}");
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

    if (createTaskType === "server_task" && !createScript.trim()) {
      message.error("server_task 任务必须填写执行脚本");
      return;
    }
    if (createTaskType === "client_task" && createRemoteMode === "script" && !createScript.trim()) {
      message.error("脚本模式必须填写执行脚本");
      return;
    }
    if (createTaskType === "client_task" && createRemoteMode === "service" && !createServiceName.trim()) {
      message.error("服务模式必须填写 serviceName");
      return;
    }

    let envPayload: Record<string, unknown> = {};
    if (createTaskType === "server_task" || createRemoteMode === "script") {
      const envResult = parseJsonObject(createEnv, "环境变量 env");
      if (!envResult.ok) {
        message.error(envResult.message);
        return;
      }
      envPayload = envResult.value;
    }

    let parsedServicePayload: unknown = undefined;
    if (createTaskType === "client_task" && createRemoteMode === "service") {
      const payloadResult = parseJsonAny(createServicePayload, "servicePayload");
      if (!payloadResult.ok) {
        message.error(payloadResult.message);
        return;
      }
      parsedServicePayload = payloadResult.value;
    }

    if (createTaskType === "client_task" && createTargetClientId && !clients.some((c) => c.clientId === createTargetClientId)) {
      message.error("目标客户端不存在，请刷新后重试");
      return;
    }

    setCreating(true);
    try {
      const res = await adminClient.post("/api/admin/tasks", {
        taskName,
        taskType: createTaskType,
        script:
          createTaskType === "server_task" || createRemoteMode === "script"
            ? createScript
            : undefined,
        serviceName:
          createTaskType === "client_task" && createRemoteMode === "service"
            ? createServiceName.trim()
            : undefined,
        servicePayload:
          createTaskType === "client_task" && createRemoteMode === "service"
            ? parsedServicePayload
            : undefined,
        timeoutSec: createTimeoutSec,
        env: envPayload,
        cwd: createTaskType === "server_task" || createRemoteMode === "script" ? createCwd || undefined : undefined,
        targetClientId: createTaskType === "client_task" ? createTargetClientId : undefined,
        requiredTags: createTaskType === "client_task" ? createRequiredTags : [],
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

  const serviceOptions = useMemo(() => {
    const allServices = clients.flatMap((client) => client.services || []);
    const dedupe = new Map<string, ServiceDef>();
    allServices.forEach((service) => {
      if (!service?.name) return;
      dedupe.set(service.name, service);
    });
    return Array.from(dedupe.values()).map((service) => ({
      value: service.name,
      label: service.version ? `${service.name} (v${service.version})` : service.name,
    }));
  }, [clients]);

  const logTaskParams = useMemo(() => (logTask ? parseTaskParams(logTask.taskParams) : {}), [logTask]);
  const logTaskStatusInfo = useMemo(() => (logTask ? parseInfo(logTask.statusInfo) : {}), [logTask]);

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
        const normalized = isTaskType(taskType) ? taskType : "server_task";
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
      title: "执行内容",
      key: "script",
      width: 240,
      ellipsis: true,
      render: (_: unknown, record: TaskRecord) => {
        const params = parseTaskParams(record.taskParams);
        const taskPayload =
          params.task_payload && typeof params.task_payload === "object" && !Array.isArray(params.task_payload)
            ? params.task_payload
            : params.taskPayload && typeof params.taskPayload === "object" && !Array.isArray(params.taskPayload)
              ? params.taskPayload
              : params.payload && typeof params.payload === "object" && !Array.isArray(params.payload)
                ? params.payload
                : {};
        const executionName =
          typeof params.execution_name === "string"
            ? params.execution_name
            : typeof params.executionName === "string"
              ? params.executionName
              : "";
        if (Object.keys(taskPayload).length > 0) {
          return (
            <Tooltip
              title={
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", maxWidth: 500 }}>
                  {JSON.stringify(taskPayload, null, 2)}
                </pre>
              }
            >
              <Tag style={{ margin: 0, border: "none", background: "#f0f5ff", color: "#1677ff", fontSize: 12 }}>
                payload
              </Tag>
            </Tooltip>
          );
        }
        if (!executionName) return <span style={{ color: "#bbb", fontSize: 12 }}>-</span>;
        return <span style={{ color: "#666", fontSize: 12 }}>execution: {executionName}</span>;
      },
    },
    {
      title: "执行节点",
      key: "executor",
      width: 170,
      render: (_: unknown, record: TaskRecord) => {
        const normalizedType = isTaskType(record.taskType) ? record.taskType : "server_task";
        if (normalizedType === "server_task") {
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
          <span
            onClick={() => openLogModal(record)}
            style={{
              fontSize: 12,
              color: "#1677ff",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <FileTextOutlined style={{ fontSize: 12 }} />
            查看日志
          </span>
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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            onClick={() => openLogModal(record)}
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
            <FileTextOutlined style={{ fontSize: 11 }} />
            日志详情
          </span>
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
      width: 140,
      render: (tags: string[]) =>
        tags.length ? (
          <span style={{ color: "#666", fontSize: 12 }}>{tags.join(", ")}</span>
        ) : (
          <span style={{ color: "#bbb", fontSize: 12 }}>-</span>
        ),
    },
    {
      title: "支持服务",
      dataIndex: "services",
      key: "services",
      width: 220,
      render: (services: ServiceDef[]) => {
        if (!services || services.length === 0) {
          return <span style={{ color: "#bbb", fontSize: 12 }}>-</span>;
        }
        const names = services.map((service) => service.name).join(", ");
        return (
          <Tooltip
            title={
              <div style={{ maxWidth: 380 }}>
                {services.map((service) => (
                  <div key={service.name} style={{ marginBottom: 6 }}>
                    <div style={{ fontWeight: 500 }}>{service.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {service.version ? `v${service.version}` : ""}
                      {service.description ? ` · ${service.description}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            }
          >
            <span style={{ color: "#666", fontSize: 12 }}>{names}</span>
          </Tooltip>
        );
      },
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
          支持两类任务：服务器执行（server_task） / 客户端执行（client_task）
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
          <span
            onClick={fetchTaskDefinitions}
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
            刷新支持任务
          </span>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #f0f0f0",
          borderRadius: 6,
          background: "#fafafa",
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500, color: "#333" }}>支持的所有 Task（已注册）</div>
          <div style={{ fontSize: 12, color: "#999" }}>执行未知 task 会返回“任务不存在”</div>
        </div>

        {definitionsLoading ? (
          <div style={{ fontSize: 12, color: "#999" }}>加载中...</div>
        ) : taskDefinitions.length === 0 ? (
          <div style={{ fontSize: 12, color: "#999" }}>暂无已注册 task</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 10 }}>
            {taskDefinitions.map((definition) => (
              <div
                key={definition.taskName}
                style={{
                  border: "1px solid #ededed",
                  borderRadius: 6,
                  background: "#fff",
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#333", fontWeight: 500 }}>{definition.title}</div>
                    <div style={{ fontSize: 11, color: "#999", fontFamily: "monospace" }}>{definition.taskName}</div>
                  </div>
                  <Tag
                    style={{
                      margin: 0,
                      border: "none",
                      background: "#f5f5f5",
                      color: taskTypeColor(definition.taskType),
                    }}
                  >
                    {taskTypeText(definition.taskType)}
                  </Tag>
                </div>

                <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.7 }}>{definition.description}</div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#999" }}>
                  模式：{definition.executeMode}
                  {definition.serviceName ? ` · service=${definition.serviceName}` : ""}
                </div>

                <div style={{ marginTop: 8, fontSize: 11, color: "#999", marginBottom: 6 }}>示例入参 task_params</div>
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 138,
                    overflow: "auto",
                    fontSize: 11,
                    padding: 8,
                    borderRadius: 4,
                    border: "1px solid #f0f0f0",
                    background: "#fafafa",
                    fontFamily: "'SF Mono', monospace",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {prettyJson(definition.exampleTaskParams)}
                </pre>

                <div style={{ marginTop: 8, fontSize: 11, color: "#999", marginBottom: 6 }}>参数说明</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {definition.params.map((param) => (
                    <div key={param.name} style={{ fontSize: 11, color: "#666", lineHeight: 1.6 }}>
                      <span style={{ fontFamily: "monospace", color: "#333" }}>{param.name}</span>
                      <span style={{ color: "#999" }}> ({param.type})</span>
                      {param.required ? <span style={{ color: "#ff4d4f" }}> *必填</span> : null}
                      <span style={{ color: "#999" }}> - {param.description}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 10 }}>
                  <span
                    onClick={() => {
                      if (triggeringTaskName) return;
                      void handleExecuteRegisteredTask(definition);
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      color: triggeringTaskName ? "#bbb" : "#333",
                      cursor: triggeringTaskName ? "default" : "pointer",
                    }}
                  >
                    <PlayCircleOutlined style={{ fontSize: 12 }} />
                    {triggeringTaskName === definition.taskName ? "触发中..." : "触发示例任务"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
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
        scroll={{ x: 1360 }}
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
              onChange={(value) => {
                setCreateTaskType(value);
                if (value === "server_task") setCreateRemoteMode("script");
              }}
              options={[
                { value: "server_task", label: "服务器执行 (server_task)" },
                { value: "client_task", label: "分发到客户端执行 (client_task)" },
              ]}
            />
          </div>
          {createTaskType === "client_task" && (
            <div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>远程任务模式</div>
              <Select
                value={createRemoteMode}
                onChange={(value) => setCreateRemoteMode(value)}
                options={[
                  { value: "script", label: "脚本模式 (script)" },
                  { value: "service", label: "服务模式 (service)" },
                ]}
              />
            </div>
          )}
          {(createTaskType === "server_task" || createRemoteMode === "script") && (
            <div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>执行脚本</div>
              <TextArea
                value={createScript}
                onChange={(e) => setCreateScript(e.target.value)}
                autoSize={{ minRows: 5, maxRows: 10 }}
                style={{ fontFamily: "'SF Mono', monospace", fontSize: 12 }}
              />
            </div>
          )}
          {createTaskType === "client_task" && createRemoteMode === "service" && (
            <>
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>服务名称 serviceName</div>
                <Input
                  value={createServiceName}
                  onChange={(e) => setCreateServiceName(e.target.value)}
                  placeholder="例如: demo.mock3s"
                />
                {serviceOptions.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "#999" }}>
                    已上报服务：{serviceOptions.map((s) => s.value).join(", ")}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>服务入参 servicePayload (JSON)</div>
                <TextArea
                  value={createServicePayload}
                  onChange={(e) => setCreateServicePayload(e.target.value)}
                  autoSize={{ minRows: 5, maxRows: 10 }}
                  style={{ fontFamily: "'SF Mono', monospace", fontSize: 12 }}
                />
              </div>
            </>
          )}
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
          {(createTaskType === "server_task" || createRemoteMode === "script") && (
            <>
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
            </>
          )}
          {createTaskType === "client_task" && (
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

      <Modal
        title={logTask ? `日志详情 · ${logTask.taskId}` : "日志详情"}
        open={logOpen}
        onCancel={() => setLogOpen(false)}
        footer={null}
        width={980}
      >
        {!logTask ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
              <div style={{ fontSize: 12, color: "#666" }}>
                <div style={{ color: "#999", marginBottom: 4 }}>任务ID</div>
                <div style={{ fontFamily: "monospace", color: "#333" }}>{logTask.taskId}</div>
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                <div style={{ color: "#999", marginBottom: 4 }}>任务名称</div>
                <div style={{ color: "#333" }}>{logTask.taskName}</div>
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                <div style={{ color: "#999", marginBottom: 4 }}>执行类型</div>
                <div style={{ color: "#333" }}>{isTaskType(logTask.taskType) ? taskTypeText(logTask.taskType) : logTask.taskType}</div>
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                <div style={{ color: "#999", marginBottom: 4 }}>状态 / 结果码</div>
                <div style={{ color: "#333" }}>
                  {logTask.status}
                  {typeof logTask.resultCode === "number" ? ` / ${logTask.resultCode}` : ""}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#999", marginBottom: 6 }}>任务参数 task_params</div>
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 220,
                    overflow: "auto",
                    fontSize: 12,
                    padding: 10,
                    border: "1px solid #f0f0f0",
                    borderRadius: 4,
                    background: "#fafafa",
                    fontFamily: "'SF Mono', monospace",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {prettyJson(logTaskParams)}
                </pre>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "#999", marginBottom: 6 }}>状态详情 status_info</div>
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 220,
                    overflow: "auto",
                    fontSize: 12,
                    padding: 10,
                    border: "1px solid #f0f0f0",
                    borderRadius: 4,
                    background: "#fafafa",
                    fontFamily: "'SF Mono', monospace",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {prettyJson(logTaskStatusInfo)}
                </pre>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#999", marginBottom: 6 }}>执行日志 execution_log</div>
              <pre
                style={{
                  margin: 0,
                  maxHeight: 320,
                  overflow: "auto",
                  fontSize: 12,
                  padding: 10,
                  border: "1px solid #f0f0f0",
                  borderRadius: 4,
                  background: "#111",
                  color: "#f5f5f5",
                  fontFamily: "'SF Mono', monospace",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.6,
                }}
              >
                {logTask.executionLog || "(暂无日志)"}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
