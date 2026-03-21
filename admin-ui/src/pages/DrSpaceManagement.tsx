import { useState, useEffect, useCallback } from "react";
import { message, Table, Modal, Input, Spin, Button, Tag, Tooltip, InputNumber, DatePicker } from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  TeamOutlined,
  KeyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { adminClient } from "../api/client";
import dayjs from "dayjs";

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

interface MemberRecord {
  userId: number;
  phone: string;
  nickname: string;
  role: string;
  joinedAt: string;
}

interface InviteCodeUser {
  userId: number;
  phone: string;
  nickname: string;
  joinedAt: string;
}

interface InviteCodeRecord {
  id: number;
  codeId: string;
  spaceId: string;
  code: string;
  label: string;
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  disabled: boolean;
  createdAt: string;
  users: InviteCodeUser[];
}

export default function DrSpaceManagement() {
  const [spaces, setSpaces] = useState<SpaceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SpaceRecord | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersTitle, setMembersTitle] = useState("");

  // Invite codes state
  const [codesOpen, setCodesOpen] = useState(false);
  const [codesSpace, setCodesSpace] = useState<SpaceRecord | null>(null);
  const [codes, setCodes] = useState<InviteCodeRecord[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [createCodeOpen, setCreateCodeOpen] = useState(false);
  const [codeLabel, setCodeLabel] = useState("");
  const [codeMaxUses, setCodeMaxUses] = useState<number | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<dayjs.Dayjs | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);

  // Code users modal
  const [codeUsersOpen, setCodeUsersOpen] = useState(false);
  const [codeUsersTitle, setCodeUsersTitle] = useState("");
  const [codeUsers, setCodeUsers] = useState<InviteCodeUser[]>([]);

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
  }, [fetchSpaces]);

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

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(
      () => message.success("邀请码已复制"),
      () => message.error("复制失败")
    );
  };

  const handleViewMembers = async (record: SpaceRecord) => {
    setMembersTitle(record.name);
    setMembersOpen(true);
    setMembersLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/spaces/${record.spaceId}/members`);
      if (res.data.code === 200) {
        setMembers(res.data.data);
      }
    } catch {
      message.error("加载成员列表失败");
    } finally {
      setMembersLoading(false);
    }
  };

  const handleViewCodes = async (record: SpaceRecord) => {
    setCodesSpace(record);
    setCodesOpen(true);
    await fetchInviteCodes(record.spaceId);
  };

  const fetchInviteCodes = async (spaceId: string) => {
    setCodesLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/invite-codes`);
      if (res.data.code === 200) {
        setCodes(res.data.data);
      }
    } catch {
      message.error("加载邀请码失败");
    } finally {
      setCodesLoading(false);
    }
  };

  const handleCreateCode = async () => {
    if (!codesSpace) return;
    setCreatingCode(true);
    try {
      const res = await adminClient.post(`/api/admin/dr/spaces/${codesSpace.spaceId}/invite-codes`, {
        label: codeLabel.trim(),
        maxUses: codeMaxUses,
        expiresAt: codeExpiresAt ? codeExpiresAt.toISOString() : null,
      });
      if (res.data.code === 200) {
        message.success("邀请码已创建");
        setCreateCodeOpen(false);
        setCodeLabel("");
        setCodeMaxUses(null);
        setCodeExpiresAt(null);
        await fetchInviteCodes(codesSpace.spaceId);
      }
    } catch {
      message.error("创建失败");
    } finally {
      setCreatingCode(false);
    }
  };

  const handleDeleteCode = (record: InviteCodeRecord) => {
    Modal.confirm({
      title: "确认删除邀请码",
      content: `确定要删除邀请码「${record.code}」吗？`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await adminClient.delete(`/api/admin/dr/invite-codes/${record.codeId}`);
          if (res.data.code === 200) {
            message.success("邀请码已删除");
            if (codesSpace) await fetchInviteCodes(codesSpace.spaceId);
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const handleViewCodeUsers = (record: InviteCodeRecord) => {
    setCodeUsersTitle(`邀请码 ${record.code} 的使用记录`);
    setCodeUsers(record.users);
    setCodeUsersOpen(true);
  };

  const columns = [
    {
      title: "空间名称",
      dataIndex: "name",
      key: "name",
      width: 160,
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
      width: 200,
      render: (_: unknown, record: SpaceRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => handleViewCodes(record)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            <KeyOutlined /> 邀请码
          </span>
          <span onClick={() => handleViewMembers(record)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            <TeamOutlined /> 成员
          </span>
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

  const memberColumns = [
    { title: "手机号", dataIndex: "phone", key: "phone", width: 130 },
    { title: "昵称", dataIndex: "nickname", key: "nickname", width: 120 },
    { title: "角色", dataIndex: "role", key: "role", width: 80 },
    {
      title: "加入时间",
      dataIndex: "joinedAt",
      key: "joinedAt",
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
  ];

  const codeColumns = [
    {
      title: "邀请码",
      dataIndex: "code",
      key: "code",
      width: 110,
      render: (v: string) => (
        <span
          onClick={() => handleCopyCode(v)}
          style={{ fontFamily: "monospace", fontSize: 13, color: "#1890ff", cursor: "pointer" }}
        >
          {v} <CopyOutlined style={{ fontSize: 11 }} />
        </span>
      ),
    },
    {
      title: "备注",
      dataIndex: "label",
      key: "label",
      width: 120,
      render: (v: string) => v || <span style={{ color: "#ccc" }}>-</span>,
    },
    {
      title: "使用情况",
      key: "usage",
      width: 100,
      render: (_: unknown, record: InviteCodeRecord) => {
        const text = record.maxUses !== null ? `${record.useCount}/${record.maxUses}` : `${record.useCount}/∞`;
        return <span>{text}</span>;
      },
    },
    {
      title: "过期时间",
      dataIndex: "expiresAt",
      key: "expiresAt",
      width: 150,
      render: (v: string | null) => {
        if (!v) return <span style={{ color: "#ccc" }}>永久有效</span>;
        const expired = new Date(v) < new Date();
        return (
          <Tooltip title={new Date(v).toLocaleString("zh-CN")}>
            <Tag color={expired ? "red" : "green"}>{expired ? "已过期" : new Date(v).toLocaleDateString("zh-CN")}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 150,
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_: unknown, record: InviteCodeRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span
            onClick={() => handleViewCodeUsers(record)}
            style={{ color: record.useCount > 0 ? "#1890ff" : "#ccc", cursor: record.useCount > 0 ? "pointer" : "default", fontSize: 13 }}
          >
            <UserOutlined /> {record.useCount}人
          </span>
          <span onClick={() => handleDeleteCode(record)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}>
            <DeleteOutlined />
          </span>
        </div>
      ),
    },
  ];

  const codeUsersColumns = [
    { title: "手机号", dataIndex: "phone", key: "phone", width: 130 },
    { title: "昵称", dataIndex: "nickname", key: "nickname", width: 120 },
    {
      title: "加入时间",
      dataIndex: "joinedAt",
      key: "joinedAt",
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
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

      {/* Create/Edit Space Modal */}
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

      {/* Members Modal */}
      <Modal
        title={`「${membersTitle}」成员列表`}
        open={membersOpen}
        onCancel={() => setMembersOpen(false)}
        footer={null}
        width={560}
      >
        {membersLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spin />
          </div>
        ) : members.length === 0 ? (
          <div style={{ textAlign: "center", color: "#999", padding: 24 }}>暂无成员</div>
        ) : (
          <Table
            dataSource={members}
            columns={memberColumns}
            rowKey="userId"
            pagination={false}
            size="small"
          />
        )}
      </Modal>

      {/* Invite Codes Modal */}
      <Modal
        title={`「${codesSpace?.name}」邀请码管理`}
        open={codesOpen}
        onCancel={() => setCodesOpen(false)}
        footer={null}
        width={720}
      >
        <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
          <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => setCreateCodeOpen(true)}>
            生成邀请码
          </Button>
        </div>
        {codesLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spin />
          </div>
        ) : codes.length === 0 ? (
          <div style={{ textAlign: "center", color: "#999", padding: 24 }}>暂无邀请码，点击「生成邀请码」创建</div>
        ) : (
          <Table
            dataSource={codes}
            columns={codeColumns}
            rowKey="codeId"
            pagination={false}
            size="small"
          />
        )}
      </Modal>

      {/* Create Invite Code Modal */}
      <Modal
        title="生成新邀请码"
        open={createCodeOpen}
        onCancel={() => {
          setCreateCodeOpen(false);
          setCodeLabel("");
          setCodeMaxUses(null);
          setCodeExpiresAt(null);
        }}
        onOk={handleCreateCode}
        okText="生成"
        cancelText="取消"
        confirmLoading={creatingCode}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>备注（可选）</div>
            <Input
              value={codeLabel}
              onChange={(e) => setCodeLabel(e.target.value)}
              placeholder="例如：内测用户、VIP渠道"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>最大使用次数（留空表示不限）</div>
            <InputNumber
              value={codeMaxUses}
              onChange={(v) => setCodeMaxUses(v)}
              min={1}
              style={{ width: "100%" }}
              placeholder="不限制"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>过期时间（留空表示永久有效）</div>
            <DatePicker
              value={codeExpiresAt}
              onChange={(v) => setCodeExpiresAt(v)}
              showTime
              style={{ width: "100%" }}
              placeholder="永久有效"
            />
          </div>
        </div>
      </Modal>

      {/* Code Users Modal */}
      <Modal
        title={codeUsersTitle}
        open={codeUsersOpen}
        onCancel={() => setCodeUsersOpen(false)}
        footer={null}
        width={500}
      >
        {codeUsers.length === 0 ? (
          <div style={{ textAlign: "center", color: "#999", padding: 24 }}>暂无使用记录</div>
        ) : (
          <Table
            dataSource={codeUsers}
            columns={codeUsersColumns}
            rowKey="userId"
            pagination={false}
            size="small"
          />
        )}
      </Modal>
    </div>
  );
}
