import { useState, useEffect, useCallback } from "react";
import { message, Table, Button, Modal, Form, Input, InputNumber, Space, Popconfirm, Tag, Select } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface QuotaRecord {
  id: number;
  userId: number;
  model: string;
  dailyLimit: number;
  user: { id: number; phone: string; nickname: string } | null;
}

interface UsageRecord {
  userId: number;
  model: string;
  date: string;
  count: number;
}

interface AiModel {
  id: number;
  model: string;
  provider: { name: string };
}

export default function DrAiQuotaManagement() {
  const [quotas, setQuotas] = useState<QuotaRecord[]>([]);
  const [usages, setUsages] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingQuota, setEditingQuota] = useState<QuotaRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [form] = Form.useForm();

  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, uRes, pRes] = await Promise.all([
        adminClient.get("/api/admin/dr/ai-quotas"),
        adminClient.get("/api/admin/dr/ai-usages", { params: { date: today } }),
        adminClient.get("/api/admin/dr/ai-providers"),
      ]);
      if (qRes.data.code === 200) setQuotas(qRes.data.data);
      if (uRes.data.code === 200) setUsages(uRes.data.data);
      if (pRes.data.code === 200) {
        const keys: string[] = [];
        for (const p of pRes.data.data) {
          for (const m of p.models as AiModel[]) {
            keys.push(`${p.name}-${m.model}`);
          }
        }
        setProviderModels(keys);
      }
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const todayUsageMap = usages.reduce<Record<string, number>>((acc, u) => {
    acc[`${u.userId}__${u.model}`] = u.count;
    return acc;
  }, {});

  const openModal = (quota?: QuotaRecord) => {
    setEditingQuota(quota ?? null);
    form.setFieldsValue(
      quota
        ? { userId: quota.userId, model: quota.model, dailyLimit: quota.dailyLimit }
        : { userId: undefined, model: undefined, dailyLimit: 10 }
    );
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await adminClient.post("/api/admin/dr/ai-quotas", values);
      message.success(editingQuota ? "已更新" : "已创建");
      setModalOpen(false);
      fetchAll();
    } catch {
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await adminClient.delete(`/api/admin/dr/ai-quotas/${id}`);
      message.success("已删除");
      fetchAll();
    } catch {
      message.error("删除失败");
    }
  };

  const columns = [
    {
      title: "用户",
      key: "user",
      render: (_: unknown, record: QuotaRecord) =>
        record.user ? (
          <Space direction="vertical" size={0}>
            <span>{record.user.phone}</span>
            {record.user.nickname && <span style={{ fontSize: 12, color: "#999" }}>{record.user.nickname}</span>}
          </Space>
        ) : (
          <span style={{ color: "#ccc" }}>ID: {record.userId}</span>
        ),
    },
    {
      title: "模型",
      dataIndex: "model",
      key: "model",
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: "每日上限",
      dataIndex: "dailyLimit",
      key: "dailyLimit",
      render: (v: number) => `${v} 次`,
    },
    {
      title: "今日已用",
      key: "todayUsage",
      render: (_: unknown, record: QuotaRecord) => {
        const used = todayUsageMap[`${record.userId}__${record.model}`] ?? 0;
        const pct = Math.round((used / record.dailyLimit) * 100);
        const color = pct >= 100 ? "red" : pct >= 80 ? "orange" : "default";
        return <Tag color={color}>{used} / {record.dailyLimit}</Tag>;
      },
    },
    {
      title: "操作",
      key: "action",
      render: (_: unknown, record: QuotaRecord) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openModal(record)}>编辑</Button>
          <Popconfirm title="确认删除此配额？" onConfirm={() => handleDelete(record.id)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>新增配额</Button>
      </div>

      <Table
        rowKey="id"
        dataSource={quotas}
        columns={columns}
        loading={loading}
        size="small"
        pagination={false}
      />

      <Modal
        title={editingQuota ? "编辑配额" : "新增配额"}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="userId" label="用户 ID" rules={[{ required: true, message: "必填" }]}>
            <InputNumber min={1} style={{ width: "100%" }} placeholder="DeepRead 用户 ID" />
          </Form.Item>
          <Form.Item name="model" label="模型（provider-model）" rules={[{ required: true, message: "必填" }]}>
            {providerModels.length > 0 ? (
              <Select
                options={providerModels.map((k) => ({ label: k, value: k }))}
                placeholder="选择模型"
                showSearch
              />
            ) : (
              <Input placeholder="如：openai-gpt-4o" />
            )}
          </Form.Item>
          <Form.Item name="dailyLimit" label="每日调用上限" rules={[{ required: true, message: "必填" }]}>
            <InputNumber min={0} style={{ width: "100%" }} addonAfter="次/天" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
