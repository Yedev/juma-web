import { useState, useEffect } from "react";
import { message, Button, Table, Tag, Modal, Form, Input, Switch, InputNumber, Space, Popconfirm, Typography } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, RobotOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface AiModel {
  id: number;
  providerId: number;
  model: string;
  enabled: boolean;
  defaultDailyLimit: number | null;
}

interface AiProvider {
  id: number;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  models: AiModel[];
}

export default function DrAiConfig() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(null);

  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiProvider | null>(null);
  const [providerForm] = Form.useForm();
  const [providerSaving, setProviderSaving] = useState(false);

  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AiModel | null>(null);
  const [modelForm] = Form.useForm();
  const [modelSaving, setModelSaving] = useState(false);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const res = await adminClient.get("/api/admin/dr/ai-providers");
      if (res.data.code === 200) {
        const list: AiProvider[] = res.data.data;
        setProviders(list);
        if (selectedProvider) {
          const updated = list.find((p) => p.id === selectedProvider.id);
          setSelectedProvider(updated ?? list[0] ?? null);
        } else {
          setSelectedProvider(list[0] ?? null);
        }
      }
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  };

  // ── Provider CRUD ──────────────────────────────────────────

  const openProviderModal = (provider?: AiProvider) => {
    setEditingProvider(provider ?? null);
    providerForm.setFieldsValue(
      provider
        ? { name: provider.name, baseUrl: provider.baseUrl, apiKey: provider.apiKey, enabled: provider.enabled }
        : { name: "", baseUrl: "", apiKey: "", enabled: true }
    );
    setProviderModalOpen(true);
  };

  const handleProviderSave = async () => {
    const values = await providerForm.validateFields();
    setProviderSaving(true);
    try {
      if (editingProvider) {
        await adminClient.put(`/api/admin/dr/ai-providers/${editingProvider.id}`, values);
        message.success("已更新");
      } else {
        await adminClient.post("/api/admin/dr/ai-providers", values);
        message.success("已创建");
      }
      setProviderModalOpen(false);
      fetchProviders();
    } catch {
      message.error("保存失败");
    } finally {
      setProviderSaving(false);
    }
  };

  const handleDeleteProvider = async (id: number) => {
    try {
      await adminClient.delete(`/api/admin/dr/ai-providers/${id}`);
      message.success("已删除");
      if (selectedProvider?.id === id) setSelectedProvider(null);
      fetchProviders();
    } catch {
      message.error("删除失败");
    }
  };

  // ── Model CRUD ─────────────────────────────────────────────

  const openModelModal = (model?: AiModel) => {
    setEditingModel(model ?? null);
    modelForm.setFieldsValue(
      model
        ? { model: model.model, enabled: model.enabled, defaultDailyLimit: model.defaultDailyLimit }
        : { model: "", enabled: true, defaultDailyLimit: null }
    );
    setModelModalOpen(true);
  };

  const handleModelSave = async () => {
    if (!selectedProvider) return;
    const values = await modelForm.validateFields();
    setModelSaving(true);
    try {
      if (editingModel) {
        await adminClient.put(`/api/admin/dr/ai-models/${editingModel.id}`, values);
        message.success("已更新");
      } else {
        await adminClient.post(`/api/admin/dr/ai-providers/${selectedProvider.id}/models`, values);
        message.success("已创建");
      }
      setModelModalOpen(false);
      fetchProviders();
    } catch {
      message.error("保存失败");
    } finally {
      setModelSaving(false);
    }
  };

  const handleDeleteModel = async (id: number) => {
    try {
      await adminClient.delete(`/api/admin/dr/ai-models/${id}`);
      message.success("已删除");
      fetchProviders();
    } catch {
      message.error("删除失败");
    }
  };

  // ── Provider Table columns ─────────────────────────────────

  const providerColumns = [
    { title: "名称", dataIndex: "name", key: "name", render: (v: string) => <b>{v}</b> },
    { title: "Base URL", dataIndex: "baseUrl", key: "baseUrl", ellipsis: true },
    {
      title: "API Key",
      dataIndex: "apiKey",
      key: "apiKey",
      render: (v: string) => <Typography.Text copyable={{ text: v }}>{v.slice(0, 6) + "****" + v.slice(-4)}</Typography.Text>,
    },
    {
      title: "状态",
      dataIndex: "enabled",
      key: "enabled",
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "禁用"}</Tag>,
    },
    {
      title: "操作",
      key: "action",
      render: (_: unknown, record: AiProvider) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openProviderModal(record)}>编辑</Button>
          <Popconfirm title="删除后该 Provider 下所有模型一并删除，确认？" onConfirm={() => handleDeleteProvider(record.id)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Model Table columns ────────────────────────────────────

  const modelColumns = [
    {
      title: "模型名",
      dataIndex: "model",
      key: "model",
      render: (v: string) => {
        const key = selectedProvider ? `${selectedProvider.name}-${v}` : v;
        return (
          <Space>
            <b>{v}</b>
            <Typography.Text type="secondary" copyable={{ text: key }} style={{ fontSize: 12 }}>
              {key}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "enabled",
      key: "enabled",
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "禁用"}</Tag>,
    },
    {
      title: "默认每日限额",
      dataIndex: "defaultDailyLimit",
      key: "defaultDailyLimit",
      render: (v: number | null) => (v == null ? <Tag>不限制</Tag> : <Tag color="blue">{v} 次/天</Tag>),
    },
    {
      title: "操作",
      key: "action",
      render: (_: unknown, record: AiModel) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openModelModal(record)}>编辑</Button>
          <Popconfirm title="确认删除此模型？" onConfirm={() => handleDeleteModel(record.id)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Provider 列表 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Space>
          <RobotOutlined />
          <span style={{ fontWeight: 500 }}>AI Provider</span>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openProviderModal()}>新建 Provider</Button>
      </div>

      <Table
        rowKey="id"
        dataSource={providers}
        columns={providerColumns}
        loading={loading}
        size="small"
        pagination={false}
        rowClassName={(record) => record.id === selectedProvider?.id ? "ant-table-row-selected" : ""}
        onRow={(record) => ({ onClick: () => setSelectedProvider(record), style: { cursor: "pointer" } })}
        style={{ marginBottom: 32 }}
      />

      {/* Model 列表 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Space>
          <span style={{ fontWeight: 500 }}>
            模型列表
            {selectedProvider && <Tag style={{ marginLeft: 8 }}>{selectedProvider.name}</Tag>}
          </span>
        </Space>
        <Button
          type="default"
          icon={<PlusOutlined />}
          disabled={!selectedProvider}
          onClick={() => openModelModal()}
        >
          添加模型
        </Button>
      </div>

      <Table
        rowKey="id"
        dataSource={selectedProvider?.models ?? []}
        columns={modelColumns}
        size="small"
        pagination={false}
        locale={{ emptyText: selectedProvider ? "暂无模型，点击「添加模型」" : "请先在上方选择一个 Provider" }}
      />

      {/* Provider Modal */}
      <Modal
        title={editingProvider ? "编辑 Provider" : "新建 Provider"}
        open={providerModalOpen}
        onOk={handleProviderSave}
        onCancel={() => setProviderModalOpen(false)}
        confirmLoading={providerSaving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={providerForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称（slug）" rules={[{ required: true, message: "必填" }]}>
            <Input placeholder="如：openai、anthropic、volcengine" disabled={!!editingProvider} />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: "必填" }]}>
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key" rules={[{ required: true, message: "必填" }]}>
            <Input.Password placeholder="sk-xxx" />
          </Form.Item>
          <Form.Item name="enabled" label="状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Model Modal */}
      <Modal
        title={editingModel ? "编辑模型" : `添加模型${selectedProvider ? ` — ${selectedProvider.name}` : ""}`}
        open={modelModalOpen}
        onOk={handleModelSave}
        onCancel={() => setModelModalOpen(false)}
        confirmLoading={modelSaving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={modelForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="model" label="模型名称" rules={[{ required: true, message: "必填" }]}>
            <Input placeholder="如：gpt-4o、claude-3-5-sonnet、doubao-pro-32k" disabled={!!editingModel} />
          </Form.Item>
          <Form.Item name="defaultDailyLimit" label="默认每日限额（留空表示不限制）">
            <InputNumber min={0} style={{ width: "100%" }} placeholder="留空 = 不限制" />
          </Form.Item>
          <Form.Item name="enabled" label="状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
