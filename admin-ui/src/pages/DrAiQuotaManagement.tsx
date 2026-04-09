import { useState, useEffect, useCallback } from "react";
import { message, Table, Button, Modal, Form, InputNumber, Space, Popconfirm, Tag, Card, Spin } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, SettingOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface QuotaRecord {
  id: number;
  userId: number;
  dailyLimit: number;
  user: { id: number; phone: string; nickname: string } | null;
}

interface UsageRecord {
  userId: number;
  date: string;
  consumed: number;
}

export default function DrAiQuotaManagement() {
  const [quotas, setQuotas] = useState<QuotaRecord[]>([]);
  const [usages, setUsages] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingQuota, setEditingQuota] = useState<QuotaRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const [defaultLimit, setDefaultLimit] = useState<number | null>(null);
  const [defaultLimitInput, setDefaultLimitInput] = useState<number | null>(null);
  const [defaultLimitLoading, setDefaultLimitLoading] = useState(false);
  const [defaultLimitSaving, setDefaultLimitSaving] = useState(false);

  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, uRes] = await Promise.all([
        adminClient.get("/api/admin/dr/ai-quotas"),
        adminClient.get("/api/admin/dr/ai-usages", { params: { date: today } }),
      ]);
      if (qRes.data.code === 200) setQuotas(qRes.data.data);
      if (uRes.data.code === 200) setUsages(uRes.data.data);
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [today]);

  const fetchDefaultLimit = useCallback(async () => {
    setDefaultLimitLoading(true);
    try {
      const res = await adminClient.get("/api/admin/config/dr_ai_default_daily_limit");
      if (res.data.code === 200) {
        const val = Number(res.data.data.configValue);
        setDefaultLimit(isNaN(val) ? 10 : val);
        setDefaultLimitInput(isNaN(val) ? 10 : val);
      } else {
        setDefaultLimit(10);
        setDefaultLimitInput(10);
      }
    } catch {
      // config not set yet, use hardcoded default
      setDefaultLimit(10);
      setDefaultLimitInput(10);
    } finally {
      setDefaultLimitLoading(false);
    }
  }, []);

  const saveDefaultLimit = async () => {
    if (defaultLimitInput == null || defaultLimitInput < 0) {
      message.warning("请输入有效的默认额度（≥ 0）");
      return;
    }
    setDefaultLimitSaving(true);
    try {
      await adminClient.put("/api/admin/config/dr_ai_default_daily_limit", {
        configValue: String(defaultLimitInput),
      });
      setDefaultLimit(defaultLimitInput);
      message.success("默认额度已保存");
    } catch {
      message.error("保存失败");
    } finally {
      setDefaultLimitSaving(false);
    }
  };

  useEffect(() => {
    fetchAll();
    fetchDefaultLimit();
  }, [fetchAll, fetchDefaultLimit]);

  const todayUsageMap = usages.reduce<Record<number, number>>((acc, u) => {
    acc[u.userId] = u.consumed;
    return acc;
  }, {});

  const openModal = (quota?: QuotaRecord) => {
    setEditingQuota(quota ?? null);
    form.setFieldsValue(
      quota
        ? { userId: quota.userId, dailyLimit: quota.dailyLimit }
        : { userId: undefined, dailyLimit: 10 }
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
      title: "每日额度",
      dataIndex: "dailyLimit",
      key: "dailyLimit",
      render: (v: number) => `${v}`,
    },
    {
      title: "今日已消耗",
      key: "todayUsage",
      render: (_: unknown, record: QuotaRecord) => {
        const used = todayUsageMap[record.userId] ?? 0;
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
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space align="center">
          <SettingOutlined />
          <span style={{ fontWeight: 500 }}>新用户默认每日额度：</span>
          {defaultLimitLoading ? (
            <Spin size="small" />
          ) : (
            <>
              <InputNumber
                min={0}
                value={defaultLimitInput}
                onChange={(v) => setDefaultLimitInput(v)}
                style={{ width: 120 }}
                placeholder="未设置"
                addonAfter="/天"
              />
              <Button
                type="primary"
                size="small"
                loading={defaultLimitSaving}
                onClick={saveDefaultLimit}
                disabled={defaultLimitInput === defaultLimit}
              >
                保存
              </Button>
            </>
          )}
        </Space>
      </Card>

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
            <InputNumber min={1} style={{ width: "100%" }} placeholder="DeepRead 用户 ID" disabled={!!editingQuota} />
          </Form.Item>
          <Form.Item name="dailyLimit" label="每日可消耗额度" rules={[{ required: true, message: "必填" }]}>
            <InputNumber min={0} style={{ width: "100%" }} addonAfter="/天" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
