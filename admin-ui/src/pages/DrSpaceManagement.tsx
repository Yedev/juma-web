import { useState, useEffect, useCallback } from "react";
import { message, Table, Modal, Input, Spin, Button, Tag } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, AppstoreOutlined, StarOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { adminClient } from "../api/client";

interface SpaceRecord {
  id: number;
  spaceId: string;
  name: string;
  description: string;
  inviteCode: string;
  memberCount: number;
  channelCount: number;
  articleCount: number;
  createdAt: string;
}

export default function DrSpaceManagement() {
  const navigate = useNavigate();
  const [spaces, setSpaces] = useState<SpaceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SpaceRecord | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [defaultSpaceId, setDefaultSpaceId] = useState<string | null>(null);

  const fetchDefaultSpace = useCallback(async () => {
    try {
      const res = await adminClient.get("/api/admin/config/dr_default_space_id");
      if (res.data.code === 200) {
        setDefaultSpaceId(JSON.parse(res.data.data.configValue));
      }
    } catch {
      // config may not exist yet
    }
  }, []);

  const handleSetDefault = async (spaceId: string) => {
    try {
      const res = await adminClient.put("/api/admin/config/dr_default_space_id", {
        configValue: JSON.stringify(spaceId),
      });
      if (res.data.code === 200) {
        message.success("已设为默认空间");
        setDefaultSpaceId(spaceId);
      }
    } catch {
      message.error("设置失败");
    }
  };

  const fetchSpaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminClient.get("/api/admin/dr/spaces");
      if (res.data.code === 200) {
        setSpaces(res.data.data);
      }
    } catch {
      message.error("加载空间列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpaces();
    fetchDefaultSpace();
  }, [fetchSpaces, fetchDefaultSpace]);

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormDesc("");
    setModalOpen(true);
  };

  const openEdit = (record: SpaceRecord) => {
    setEditing(record);
    setFormName(record.name);
    setFormDesc(record.description);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      message.error("空间名称不能为空");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const res = await adminClient.put(`/api/admin/dr/spaces/${editing.spaceId}`, {
          name: formName.trim(),
          description: formDesc.trim(),
        });
        if (res.data.code === 200) {
          message.success("空间已更新");
          setModalOpen(false);
          fetchSpaces();
        }
      } else {
        const res = await adminClient.post("/api/admin/dr/spaces", {
          name: formName.trim(),
          description: formDesc.trim(),
        });
        if (res.data.code === 200) {
          message.success("空间已创建");
          setModalOpen(false);
          fetchSpaces();
        }
      }
    } catch {
      message.error("操作失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (record: SpaceRecord) => {
    Modal.confirm({
      title: "确认删除",
      content: `确定要删除空间「${record.name}」吗？将同时删除该空间下的所有频道、文章和成员关系。此操作不可恢复。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await adminClient.delete(`/api/admin/dr/spaces/${record.spaceId}`);
          if (res.data.code === 200) {
            message.success("空间已删除");
            fetchSpaces();
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const columns = [
    {
      title: "空间名称",
      dataIndex: "name",
      key: "name",
      width: 160,
      render: (name: string, record: SpaceRecord) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            onClick={() => navigate(`/dr/spaces/${record.spaceId}`)}
            style={{ color: "#333", cursor: "pointer", fontWeight: 500 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#1890ff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#333")}
          >
            {name}
          </span>
          {record.spaceId === defaultSpaceId && <Tag color="blue">默认</Tag>}
        </span>
      ),
    },
    {
      title: "Space ID",
      dataIndex: "spaceId",
      key: "spaceId",
      width: 140,
      render: (v: string) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{v}</span>,
    },
    {
      title: "成员数",
      dataIndex: "memberCount",
      key: "memberCount",
      width: 80,
      align: "center" as const,
    },
    {
      title: "频道数",
      dataIndex: "channelCount",
      key: "channelCount",
      width: 80,
      align: "center" as const,
    },
    {
      title: "文章数",
      dataIndex: "articleCount",
      key: "articleCount",
      width: 80,
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
      width: 220,
      render: (_: unknown, record: SpaceRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => navigate(`/dr/spaces/${record.spaceId}`)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            <AppstoreOutlined /> 管理
          </span>
          <span onClick={() => openEdit(record)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            <EditOutlined /> 编辑
          </span>
          {record.spaceId !== defaultSpaceId && (
            <span onClick={() => handleSetDefault(record.spaceId)} style={{ color: "#1890ff", cursor: "pointer", fontSize: 13 }}>
              <StarOutlined /> 默认
            </span>
          )}
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
        <span style={{ fontSize: 13, color: "#999" }}>共 {spaces.length} 个空间</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 4 }}>
          新建空间
        </Button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : (
        <Table
          dataSource={spaces}
          columns={columns}
          rowKey="spaceId"
          pagination={false}
          size="small"
        />
      )}

      <Modal
        title={editing ? "编辑空间" : "新建空间"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>空间名称 *</div>
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="请输入空间名称"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>描述</div>
            <Input.TextArea
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder="请输入空间描述"
              rows={3}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
