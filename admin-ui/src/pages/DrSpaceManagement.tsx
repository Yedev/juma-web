import { useState, useEffect, useCallback } from "react";
import {
  message,
  Table,
  Modal,
  Input,
  Spin,
  Button,
  Tag,
  Tooltip,
  InputNumber,
  DatePicker,
  Drawer,
  Select,
  Space,
  Card,
  Typography,
  Popconfirm,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  TeamOutlined,
  KeyOutlined,
  UserOutlined,
  AppstoreOutlined,
  DragOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { adminClient } from "../api/client";
import dayjs from "dayjs";

const { Text } = Typography;

const LAYOUT_TYPES = [
  { value: "large_card", label: "大图卡" },
  { value: "horizontal_card", label: "横向卡" },
  { value: "vertical_card", label: "纵向卡" },
  { value: "waterfall", label: "瀑布流" },
];

const layoutLabel = (type: string) => LAYOUT_TYPES.find((t) => t.value === type)?.label ?? type;
const layoutColor = (type: string): string => {
  const map: Record<string, string> = {
    large_card: "blue",
    horizontal_card: "cyan",
    vertical_card: "green",
    waterfall: "purple",
  };
  return map[type] ?? "default";
};

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

interface ChannelDetail {
  channelId: string;
  name: string;
  spaceId: string;
  sortOrder: number;
}

interface ArticleDetail {
  articleId: string;
  title: string;
  spaceId: string;
  channelId: string;
  coverUrl: string;
  summary: string;
}

interface ModuleResource {
  id: number;
  moduleId: string;
  resourceType: "channel" | "article";
  resourceId: string;
  sortOrder: number;
  detail: ChannelDetail | ArticleDetail | null;
}

interface HomepageModule {
  id: number;
  moduleId: string;
  spaceId: string;
  title: string;
  subtitle: string;
  layoutType: string;
  sortOrder: number;
  createdAt: string;
  resources: ModuleResource[];
}

interface ChannelOption {
  channelId: string;
  name: string;
}

interface ArticleOption {
  articleId: string;
  title: string;
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

  // Homepage modules state
  const [homepageOpen, setHomepageOpen] = useState(false);
  const [homepageSpace, setHomepageSpace] = useState<SpaceRecord | null>(null);
  const [modules, setModules] = useState<HomepageModule[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [moduleModalOpen, setModuleModalOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<HomepageModule | null>(null);
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleSubtitle, setModuleSubtitle] = useState("");
  const [moduleLayoutType, setModuleLayoutType] = useState("large_card");
  const [savingModule, setSavingModule] = useState(false);

  // Resource binding state
  const [resourceModalOpen, setResourceModalOpen] = useState(false);
  const [resourceTargetModule, setResourceTargetModule] = useState<HomepageModule | null>(null);
  const [resourceType, setResourceType] = useState<"channel" | "article">("channel");
  const [resourceId, setResourceId] = useState<string>("");
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [articleOptions, setArticleOptions] = useState<ArticleOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [addingResource, setAddingResource] = useState(false);

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

  // ── Homepage Module handlers ──

  const fetchHomepageModules = async (spaceId: string) => {
    setModulesLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/homepage-modules`);
      if (res.data.code === 200) setModules(res.data.data);
    } catch {
      message.error("加载首页模块失败");
    } finally {
      setModulesLoading(false);
    }
  };

  const handleOpenHomepage = async (record: SpaceRecord) => {
    setHomepageSpace(record);
    setHomepageOpen(true);
    await fetchHomepageModules(record.spaceId);
  };

  const openCreateModule = () => {
    setEditingModule(null);
    setModuleTitle("");
    setModuleSubtitle("");
    setModuleLayoutType("large_card");
    setModuleModalOpen(true);
  };

  const openEditModule = (mod: HomepageModule) => {
    setEditingModule(mod);
    setModuleTitle(mod.title);
    setModuleSubtitle(mod.subtitle);
    setModuleLayoutType(mod.layoutType);
    setModuleModalOpen(true);
  };

  const handleSaveModule = async () => {
    if (!moduleTitle.trim()) {
      message.error("模块标题不能为空");
      return;
    }
    if (!homepageSpace) return;
    setSavingModule(true);
    try {
      if (editingModule) {
        const res = await adminClient.put(`/api/admin/dr/homepage-modules/${editingModule.moduleId}`, {
          title: moduleTitle.trim(),
          subtitle: moduleSubtitle.trim(),
          layoutType: moduleLayoutType,
        });
        if (res.data.code === 200) {
          message.success("模块已更新");
          setModuleModalOpen(false);
          await fetchHomepageModules(homepageSpace.spaceId);
        }
      } else {
        const res = await adminClient.post(`/api/admin/dr/spaces/${homepageSpace.spaceId}/homepage-modules`, {
          title: moduleTitle.trim(),
          subtitle: moduleSubtitle.trim(),
          layoutType: moduleLayoutType,
        });
        if (res.data.code === 200) {
          message.success("模块已创建");
          setModuleModalOpen(false);
          await fetchHomepageModules(homepageSpace.spaceId);
        }
      }
    } catch {
      message.error("操作失败");
    } finally {
      setSavingModule(false);
    }
  };

  const handleDeleteModule = (mod: HomepageModule) => {
    Modal.confirm({
      title: "确认删除模块",
      content: `确定要删除模块「${mod.title}」吗？将同时移除该模块下的所有资源绑定。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!homepageSpace) return;
        try {
          const res = await adminClient.delete(`/api/admin/dr/homepage-modules/${mod.moduleId}`);
          if (res.data.code === 200) {
            message.success("模块已删除");
            await fetchHomepageModules(homepageSpace.spaceId);
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const openAddResource = async (mod: HomepageModule) => {
    if (!homepageSpace) return;
    setResourceTargetModule(mod);
    setResourceType("channel");
    setResourceId("");
    setResourceModalOpen(true);
    setLoadingOptions(true);
    try {
      const [chRes, artRes] = await Promise.all([
        adminClient.get(`/api/admin/dr/channels?space_id=${homepageSpace.spaceId}`),
        adminClient.get(`/api/admin/dr/articles?space_id=${homepageSpace.spaceId}&page_size=200`),
      ]);
      if (chRes.data.code === 200) setChannelOptions(chRes.data.data ?? []);
      if (artRes.data.code === 200) setArticleOptions(artRes.data.data?.list ?? []);
    } catch {
      message.error("加载资源选项失败");
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleAddResource = async () => {
    if (!resourceTargetModule || !resourceId) {
      message.error("请选择资源");
      return;
    }
    setAddingResource(true);
    try {
      const res = await adminClient.post(`/api/admin/dr/homepage-modules/${resourceTargetModule.moduleId}/resources`, {
        resourceType,
        resourceId,
      });
      if (res.data.code === 200) {
        message.success("资源已添加");
        setResourceModalOpen(false);
        if (homepageSpace) await fetchHomepageModules(homepageSpace.spaceId);
      }
    } catch {
      message.error("添加失败");
    } finally {
      setAddingResource(false);
    }
  };

  const handleRemoveResource = async (mod: HomepageModule, resourceId: string) => {
    if (!homepageSpace) return;
    try {
      const res = await adminClient.delete(`/api/admin/dr/homepage-modules/${mod.moduleId}/resources/${resourceId}`);
      if (res.data.code === 200) {
        message.success("资源已移除");
        await fetchHomepageModules(homepageSpace.spaceId);
      }
    } catch {
      message.error("移除失败");
    }
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
      width: 240,
      render: (_: unknown, record: SpaceRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => handleOpenHomepage(record)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            <AppstoreOutlined /> 首页
          </span>
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

      {/* Homepage Modules Drawer */}
      <Drawer
        title={
          <span>
            <AppstoreOutlined style={{ marginRight: 8 }} />
            {homepageSpace?.name} — 首页配置
          </span>
        }
        open={homepageOpen}
        onClose={() => setHomepageOpen(false)}
        width={680}
        extra={
          <Button type="primary" icon={<PlusOutlined />} size="small" onClick={openCreateModule}>
            添加模块
          </Button>
        }
      >
        {modulesLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
            <Spin />
          </div>
        ) : modules.length === 0 ? (
          <div style={{ textAlign: "center", color: "#999", padding: 48 }}>
            <AppstoreOutlined style={{ fontSize: 32, marginBottom: 12, display: "block" }} />
            暂无首页模块，点击右上角「添加模块」开始配置
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {modules.map((mod, idx) => (
              <Card
                key={mod.moduleId}
                size="small"
                styles={{ header: { padding: "8px 16px" }, body: { padding: "12px 16px" } }}
                title={
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <DragOutlined style={{ color: "#bbb", cursor: "grab" }} />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{mod.title}</span>
                    {mod.subtitle && (
                      <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                        {mod.subtitle}
                      </Text>
                    )}
                    <Tag color={layoutColor(mod.layoutType)} style={{ marginLeft: 4, fontSize: 11 }}>
                      {layoutLabel(mod.layoutType)}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
                      #{idx + 1}
                    </Text>
                  </div>
                }
                extra={
                  <Space size={8}>
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => openAddResource(mod)}
                    >
                      绑定资源
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openEditModule(mod)}
                    />
                    <Popconfirm
                      title="确认删除模块"
                      description={`将同时移除「${mod.title}」下所有资源绑定`}
                      onConfirm={() => handleDeleteModule(mod)}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                    </Popconfirm>
                  </Space>
                }
              >
                {mod.resources.length === 0 ? (
                  <div style={{ color: "#bbb", fontSize: 12 }}>暂未绑定资源</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {mod.resources.map((r) => {
                      const isChannel = r.resourceType === "channel";
                      const detail = r.detail as (ChannelDetail & ArticleDetail) | null;
                      return (
                        <div
                          key={r.resourceId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 8px",
                            background: "#fafafa",
                            borderRadius: 4,
                            border: "1px solid #f0f0f0",
                          }}
                        >
                          <Tag color={isChannel ? "geekblue" : "orange"} style={{ fontSize: 11, margin: 0 }}>
                            {isChannel ? "频道" : "文章"}
                          </Tag>
                          <span style={{ flex: 1, fontSize: 13, color: "#333" }}>
                            {detail ? (isChannel ? detail.name : detail.title) : r.resourceId}
                          </span>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#bbb" }}>
                            {r.resourceId}
                          </span>
                          <Popconfirm
                            title="确认移除该资源？"
                            onConfirm={() => handleRemoveResource(mod, r.resourceId)}
                            okText="移除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                          >
                            <MinusCircleOutlined style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }} />
                          </Popconfirm>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </Drawer>

      {/* Create/Edit Module Modal */}
      <Modal
        title={editingModule ? "编辑模块" : "添加首页模块"}
        open={moduleModalOpen}
        onCancel={() => setModuleModalOpen(false)}
        onOk={handleSaveModule}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingModule}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>模块标题 *</div>
            <Input
              value={moduleTitle}
              onChange={(e) => setModuleTitle(e.target.value)}
              placeholder="例如：推荐阅读"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>副标题（小字说明，可选）</div>
            <Input
              value={moduleSubtitle}
              onChange={(e) => setModuleSubtitle(e.target.value)}
              placeholder="例如：精选内容每日更新"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>资源排列方式</div>
            <Select
              value={moduleLayoutType}
              onChange={(v) => setModuleLayoutType(v)}
              style={{ width: "100%" }}
              options={LAYOUT_TYPES}
            />
          </div>
        </div>
      </Modal>

      {/* Add Resource Modal */}
      <Modal
        title={`绑定资源 — ${resourceTargetModule?.title}`}
        open={resourceModalOpen}
        onCancel={() => setResourceModalOpen(false)}
        onOk={handleAddResource}
        okText="绑定"
        cancelText="取消"
        confirmLoading={addingResource}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>资源类型</div>
            <Select
              value={resourceType}
              onChange={(v) => {
                setResourceType(v);
                setResourceId("");
              }}
              style={{ width: "100%" }}
              options={[
                { value: "channel", label: "频道" },
                { value: "article", label: "文章" },
              ]}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>
              选择{resourceType === "channel" ? "频道" : "文章"}
            </div>
            {loadingOptions ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
                <Spin size="small" />
              </div>
            ) : (
              <Select
                value={resourceId || undefined}
                onChange={(v) => setResourceId(v)}
                style={{ width: "100%" }}
                placeholder={`请选择${resourceType === "channel" ? "频道" : "文章"}`}
                showSearch
                optionFilterProp="label"
                options={
                  resourceType === "channel"
                    ? channelOptions.map((c) => ({ value: c.channelId, label: c.name }))
                    : articleOptions.map((a) => ({ value: a.articleId, label: a.title }))
                }
              />
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
