import { useState, useEffect, useCallback } from "react";
import { message, Table, Modal, Input, InputNumber, Select, Spin, Button } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface SpaceOption {
  spaceId: string;
  name: string;
}

interface ChannelRecord {
  id: number;
  channelId: string;
  spaceId: string;
  name: string;
  coverUrl: string;
  sortOrder: number;
  articleCount: number;
  createdAt: string;
}

export default function DrChannelManagement() {
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | undefined>(undefined);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelRecord | null>(null);
  const [formName, setFormName] = useState("");
  const [formCoverUrl, setFormCoverUrl] = useState("");
  const [formSpaceId, setFormSpaceId] = useState<string | undefined>(undefined);
  const [formSort, setFormSort] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  const fetchSpaces = useCallback(async () => {
    try {
      const res = await adminClient.get("/api/admin/dr/spaces");
      if (res.data.code === 200) {
        setSpaces(res.data.data.map((s: SpaceOption) => ({ spaceId: s.spaceId, name: s.name })));
      }
    } catch {
      message.error("加载空间列表失败");
    }
  }, []);

  const fetchChannels = useCallback(async (spaceId?: string) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (spaceId) params.space_id = spaceId;
      const res = await adminClient.get("/api/admin/dr/channels", { params });
      if (res.data.code === 200) {
        setChannels(res.data.data);
      }
    } catch {
      message.error("加载频道列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpaces();
  }, [fetchSpaces]);

  useEffect(() => {
    fetchChannels(selectedSpaceId);
  }, [selectedSpaceId, fetchChannels]);

  const spaceNameMap = new Map(spaces.map((s) => [s.spaceId, s.name]));

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormCoverUrl("");
    setFormSpaceId(selectedSpaceId);
    setFormSort(0);
    setModalOpen(true);
  };

  const openEdit = (record: ChannelRecord) => {
    setEditing(record);
    setFormName(record.name);
    setFormCoverUrl(record.coverUrl || "");
    setFormSpaceId(record.spaceId);
    setFormSort(record.sortOrder);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      message.error("频道名称不能为空");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const res = await adminClient.put(`/api/admin/dr/channels/${editing.channelId}`, {
          name: formName.trim(),
          coverUrl: formCoverUrl.trim(),
          sortOrder: formSort,
        });
        if (res.data.code === 200) {
          message.success("频道已更新");
          setModalOpen(false);
          fetchChannels(selectedSpaceId);
        }
      } else {
        if (!formSpaceId) {
          message.error("请选择所属空间");
          setSaving(false);
          return;
        }
        const res = await adminClient.post("/api/admin/dr/channels", {
          name: formName.trim(),
          coverUrl: formCoverUrl.trim(),
          spaceId: formSpaceId,
          sortOrder: formSort,
        });
        if (res.data.code === 200) {
          message.success("频道已创建");
          setModalOpen(false);
          fetchChannels(selectedSpaceId);
        }
      }
    } catch {
      message.error("操作失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (record: ChannelRecord) => {
    Modal.confirm({
      title: "确认删除",
      content: `确定要删除频道「${record.name}」吗？此操作不可恢复。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await adminClient.delete(`/api/admin/dr/channels/${record.channelId}`);
          if (res.data.code === 200) {
            message.success("频道已删除");
            fetchChannels(selectedSpaceId);
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const columns = [
    {
      title: "频道名称",
      dataIndex: "name",
      key: "name",
      width: 160,
    },
    {
      title: "Channel ID",
      dataIndex: "channelId",
      key: "channelId",
      width: 150,
      render: (v: string) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{v}</span>,
    },
    {
      title: "所属空间",
      dataIndex: "spaceId",
      key: "spaceId",
      width: 140,
      render: (v: string) => spaceNameMap.get(v) || v,
    },
    {
      title: "封面",
      dataIndex: "coverUrl",
      key: "coverUrl",
      width: 60,
      align: "center" as const,
      render: (v: string) =>
        v ? (
          <img src={v} alt="cover" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} />
        ) : (
          <span style={{ color: "#ddd", fontSize: 11 }}>无</span>
        ),
    },
    {
      title: "文章数",
      dataIndex: "articleCount",
      key: "articleCount",
      width: 80,
      align: "center" as const,
    },
    {
      title: "排序",
      dataIndex: "sortOrder",
      key: "sortOrder",
      width: 70,
      align: "center" as const,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_: unknown, record: ChannelRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => openEdit(record)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            <EditOutlined /> 编辑
          </span>
          <span onClick={() => handleDelete(record)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}>
            <DeleteOutlined />
          </span>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#666" }}>空间筛选：</span>
          <Select
            value={selectedSpaceId}
            onChange={setSelectedSpaceId}
            allowClear
            placeholder="全部空间"
            style={{ width: 200 }}
            options={spaces.map((s) => ({ value: s.spaceId, label: s.name }))}
          />
          <span style={{ fontSize: 13, color: "#999" }}>共 {channels.length} 个频道</span>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 4 }}>
          新建频道
        </Button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : (
        <Table
          dataSource={channels}
          columns={columns}
          rowKey="channelId"
          pagination={false}
          size="small"
        />
      )}

      <Modal
        title={editing ? "编辑频道" : "新建频道"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>频道名称 *</div>
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="请输入频道名称"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>封面图片 URL</div>
            <Input
              value={formCoverUrl}
              onChange={(e) => setFormCoverUrl(e.target.value)}
              placeholder="https://example.com/cover.jpg"
            />
          </div>
          {!editing && (
            <div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>所属空间 *</div>
              <Select
                value={formSpaceId}
                onChange={setFormSpaceId}
                placeholder="请选择空间"
                style={{ width: "100%" }}
                options={spaces.map((s) => ({ value: s.spaceId, label: s.name }))}
              />
            </div>
          )}
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>排序值</div>
            <InputNumber
              value={formSort}
              onChange={(v) => setFormSort(v ?? 0)}
              min={0}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
