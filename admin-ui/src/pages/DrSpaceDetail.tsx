import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  message,
  Tabs,
  Spin,
  Table,
  Modal,
  Input,
  InputNumber,
  Select,
  Button,
  Tag,
  Tooltip,
  Drawer,
  Space,
  Card,
  Typography,
  Popconfirm,
  DatePicker,
  Avatar,
} from "antd";
import {
  ArrowLeftOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  TeamOutlined,
  KeyOutlined,
  UserOutlined,
  AppstoreOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  MinusCircleOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  BranchesOutlined,
  FolderOutlined,
  ReadOutlined,
  StarOutlined,
  HighlightOutlined,
  HolderOutlined,
} from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { adminClient } from "../api/client";
import { MobilePreviewStage } from "../components/MobilePreviewModal";
import dayjs from "dayjs";

const { Text } = Typography;

// ── Shared types ──

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

interface CollectionRecord {
  id: number;
  collectionId: string;
  spaceId: string;
  name: string;
  description: string;
  coverUrl: string;
  sortOrder: number;
  articleCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CollectionArticleItem {
  collectionId: string;
  articleId: string;
  sortOrder: number;
  addedAt: string;
  article: { articleId: string; title: string; coverUrl: string; author: string; publishedAt: string } | null;
}

interface ArticleRecord {
  id: number;
  articleId: string;
  spaceId: string;
  channelId: string;
  title: string;
  summary: string;
  coverUrl: string;
  layoutType: string;
  author: string;
  readCount: number;
  bookmarkCount: number;
  publishedAt: string;
  createdAt: string;
}

interface ArticleDetail extends ArticleRecord {
  content: string;
  contentType: string;
}

interface ChannelOption { channelId: string; name: string }
interface ArticleOption { articleId: string; title: string; author?: string }
interface CollectionOption { collectionId: string; name: string; description?: string; coverUrl?: string }

interface MemberRecord { userId: number; phone: string; nickname: string; role: string; joinedAt: string }

interface InviteCodeUser { userId: number; phone: string; nickname: string; joinedAt: string }
interface InviteCodeRecord {
  id: number; codeId: string; spaceId: string; code: string; label: string;
  maxUses: number | null; useCount: number; expiresAt: string | null; disabled: boolean;
  createdAt: string; users: InviteCodeUser[];
}

interface PickRecord {
  id: number; pickId: string; spaceId: string; articleId: string;
  reason: string; sortOrder: number; enabled: boolean;
  createdAt: string; updatedAt: string;
  article: { articleId: string; title: string; coverUrl: string; author: string; publishedAt: string } | null;
  highlightCount: number;
}

interface EditorHighlight {
  highlightId: string; articleId: string; contextBefore?: string; contextAfter?: string;
  text: string; color: string; positionData: string; note: string;
  sortOrder: number; createdAt: string; updatedAt: string;
}

interface LatticeConfig {
  latticeId: string; spaceId: string; collectionId: string;
  weeklyTopic: string; recommendation: string; enabled: boolean; nodeNames: string[];
  collection: { collectionId: string; name: string; description: string; coverUrl: string } | null;
  articleCount: number;
}

interface ModuleResource {
  id: number; moduleId: string; resourceType: "channel" | "article" | "collection";
  resourceId: string; sortOrder: number;
  detail: (ChannelOption & { spaceId: string; sortOrder: number }) | (ArticleOption & { spaceId: string; channelId: string; coverUrl: string; summary: string }) | (CollectionOption & { coverUrl: string; description: string }) | null;
}

interface HomepageModule {
  id: number; moduleId: string; spaceId: string; moduleType: string;
  title: string; subtitle: string; description: string;
  layoutType: string; sourceType: string; sourceId: string;
  sortOrder: number; createdAt: string; resources: ModuleResource[];
}

const LAYOUT_TYPES = [
  { value: "large_horizontal", label: "大图横向" },
  { value: "small_horizontal", label: "小图横向" },
  { value: "large_vertical", label: "大图纵向" },
  { value: "small_vertical", label: "小图纵向" },
  { value: "plain_text", label: "纯文本" },
];
const layoutLabel = (type: string) => LAYOUT_TYPES.find((t) => t.value === type)?.label ?? type;
const layoutColor = (type: string): string => {
  const map: Record<string, string> = { large_horizontal: "blue", small_horizontal: "cyan", large_vertical: "green", small_vertical: "lime", plain_text: "default" };
  return map[type] ?? "default";
};

function buildDefaultNodeName(title: string): string {
  const source = title.split(/[：:|｜\-]/)[0]?.trim() || title.trim();
  const compact = source.replace(/[，。！？；、,.!?;()\[\]（）【】"'"]/g, "").replace(/\s+/g, "");
  return compact.slice(0, 6) || title.trim().slice(0, 6);
}

function buildDefaultNodeNames(titles: string[]): string[] {
  const used = new Map<string, number>();
  return titles.map((title) => {
    const base = buildDefaultNodeName(title) || "节点";
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}${count + 1}`;
  });
}

// ════════════════════════════════════════
// Tab: Channels
// ════════════════════════════════════════
function ChannelsTab({ spaceId }: { spaceId: string }) {
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelRecord | null>(null);
  const [formName, setFormName] = useState("");
  const [formCoverUrl, setFormCoverUrl] = useState("");
  const [formSort, setFormSort] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminClient.get("/api/admin/dr/channels", { params: { space_id: spaceId } });
      if (res.data.code === 200) setChannels(res.data.data);
    } catch { message.error("加载频道列表失败"); }
    finally { setLoading(false); }
  }, [spaceId]);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  const openCreate = () => { setEditing(null); setFormName(""); setFormCoverUrl(""); setFormSort(0); setModalOpen(true); };
  const openEdit = (r: ChannelRecord) => { setEditing(r); setFormName(r.name); setFormCoverUrl(r.coverUrl || ""); setFormSort(r.sortOrder); setModalOpen(true); };

  const handleSave = async () => {
    if (!formName.trim()) { message.error("频道名称不能为空"); return; }
    setSaving(true);
    try {
      if (editing) {
        const res = await adminClient.put(`/api/admin/dr/channels/${editing.channelId}`, { name: formName.trim(), coverUrl: formCoverUrl.trim(), sortOrder: formSort });
        if (res.data.code === 200) { message.success("频道已更新"); setModalOpen(false); fetchChannels(); }
      } else {
        const res = await adminClient.post("/api/admin/dr/channels", { name: formName.trim(), coverUrl: formCoverUrl.trim(), spaceId, sortOrder: formSort });
        if (res.data.code === 200) { message.success("频道已创建"); setModalOpen(false); fetchChannels(); }
      }
    } catch { message.error("操作失败"); }
    finally { setSaving(false); }
  };

  const handleDelete = (r: ChannelRecord) => {
    Modal.confirm({
      title: "确认删除", content: `确定要删除频道「${r.name}」吗？此操作不可恢复。`,
      okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => {
        try { const res = await adminClient.delete(`/api/admin/dr/channels/${r.channelId}`); if (res.data.code === 200) { message.success("频道已删除"); fetchChannels(); } }
        catch { message.error("删除失败"); }
      },
    });
  };

  const columns = [
    { title: "频道名称", dataIndex: "name", key: "name", width: 160 },
    { title: "Channel ID", dataIndex: "channelId", key: "channelId", width: 150, render: (v: string) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{v}</span> },
    { title: "封面", dataIndex: "coverUrl", key: "coverUrl", width: 60, align: "center" as const, render: (v: string) => v ? <img src={v} alt="cover" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} /> : <span style={{ color: "#ddd", fontSize: 11 }}>无</span> },
    { title: "文章数", dataIndex: "articleCount", key: "articleCount", width: 80, align: "center" as const },
    { title: "排序", dataIndex: "sortOrder", key: "sortOrder", width: 70, align: "center" as const },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: (v: string) => new Date(v).toLocaleString("zh-CN") },
    {
      title: "操作", key: "actions", width: 120,
      render: (_: unknown, r: ChannelRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => openEdit(r)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}><EditOutlined /> 编辑</span>
          <span onClick={() => handleDelete(r)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}><DeleteOutlined /></span>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#999" }}>共 {channels.length} 个频道</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 4 }}>新建频道</Button>
      </div>
      {loading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin /></div> : <Table dataSource={channels} columns={columns} rowKey="channelId" pagination={false} size="small" />}
      <Modal title={editing ? "编辑频道" : "新建频道"} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave} okText="保存" cancelText="取消" confirmLoading={saving}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>频道名称 *</div><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="请输入频道名称" /></div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>封面图片 URL</div><Input value={formCoverUrl} onChange={(e) => setFormCoverUrl(e.target.value)} placeholder="https://example.com/cover.jpg" /></div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>排序值</div><InputNumber value={formSort} onChange={(v) => setFormSort(v ?? 0)} min={0} style={{ width: "100%" }} /></div>
        </div>
      </Modal>
    </div>
  );
}

// ════════════════════════════════════════
// Tab: Collections
// ════════════════════════════════════════
function CollectionsTab({ spaceId }: { spaceId: string }) {
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CollectionRecord | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCoverUrl, setFormCoverUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const [articlesOpen, setArticlesOpen] = useState(false);
  const [articlesCollection, setArticlesCollection] = useState<CollectionRecord | null>(null);
  const [collectionArticles, setCollectionArticles] = useState<CollectionArticleItem[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [addArticleOpen, setAddArticleOpen] = useState(false);
  const [articleOptions, setArticleOptions] = useState<ArticleOption[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [loadingArticleOptions, setLoadingArticleOptions] = useState(false);
  const [addingArticle, setAddingArticle] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const fetchCollections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/collections`);
      if (res.data.code === 200) setCollections(res.data.data);
    } catch { message.error("加载集合列表失败"); }
    finally { setLoading(false); }
  }, [spaceId]);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  const openCreate = () => { setEditing(null); setFormName(""); setFormDesc(""); setFormCoverUrl(""); setModalOpen(true); };
  const openEdit = (r: CollectionRecord) => { setEditing(r); setFormName(r.name); setFormDesc(r.description || ""); setFormCoverUrl(r.coverUrl || ""); setModalOpen(true); };

  const handleSave = async () => {
    if (!formName.trim()) { message.error("集合名称不能为空"); return; }
    setSaving(true);
    try {
      if (editing) {
        const res = await adminClient.put(`/api/admin/dr/collections/${editing.collectionId}`, { name: formName.trim(), description: formDesc.trim(), coverUrl: formCoverUrl.trim() });
        if (res.data.code === 200) { message.success("集合已更新"); setModalOpen(false); fetchCollections(); }
      } else {
        const res = await adminClient.post(`/api/admin/dr/spaces/${spaceId}/collections`, { name: formName.trim(), description: formDesc.trim(), coverUrl: formCoverUrl.trim() });
        if (res.data.code === 200) { message.success("集合已创建"); setModalOpen(false); fetchCollections(); }
      }
    } catch { message.error("操作失败"); }
    finally { setSaving(false); }
  };

  const handleDelete = (r: CollectionRecord) => {
    Modal.confirm({
      title: "确认删除", content: `确定要删除集合「${r.name}」吗？将同时移除该集合下所有文章关联。此操作不可恢复。`,
      okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => {
        try { const res = await adminClient.delete(`/api/admin/dr/collections/${r.collectionId}`); if (res.data.code === 200) { message.success("集合已删除"); fetchCollections(); } }
        catch { message.error("删除失败"); }
      },
    });
  };

  const fetchCollectionArticles = async (collectionId: string) => {
    setArticlesLoading(true);
    try { const res = await adminClient.get(`/api/admin/dr/collections/${collectionId}/articles`); if (res.data.code === 200) setCollectionArticles(res.data.data); }
    catch { message.error("加载文章失败"); }
    finally { setArticlesLoading(false); }
  };

  const handleViewArticles = async (r: CollectionRecord) => { setArticlesCollection(r); setArticlesOpen(true); await fetchCollectionArticles(r.collectionId); };

  const openAddArticle = async () => {
    if (!articlesCollection) return;
    setSelectedArticleId(""); setAddArticleOpen(true); setLoadingArticleOptions(true);
    try { const res = await adminClient.get(`/api/admin/dr/articles?space_id=${spaceId}&page_size=200`); if (res.data.code === 200) setArticleOptions(res.data.data?.list ?? []); }
    catch { message.error("加载文章列表失败"); }
    finally { setLoadingArticleOptions(false); }
  };

  const handleAddArticle = async () => {
    if (!articlesCollection || !selectedArticleId) { message.error("请选择文章"); return; }
    setAddingArticle(true);
    try {
      const res = await adminClient.post(`/api/admin/dr/collections/${articlesCollection.collectionId}/articles`, { articleId: selectedArticleId });
      if (res.data.code === 200) { message.success("文章已加入集合"); setAddArticleOpen(false); await fetchCollectionArticles(articlesCollection.collectionId); }
    } catch { message.error("添加失败"); }
    finally { setAddingArticle(false); }
  };

  const handleRemoveArticle = async (articleId: string) => {
    if (!articlesCollection) return;
    try { const res = await adminClient.delete(`/api/admin/dr/collections/${articlesCollection.collectionId}/articles/${articleId}`); if (res.data.code === 200) { message.success("文章已移除"); await fetchCollectionArticles(articlesCollection.collectionId); } }
    catch { message.error("移除失败"); }
  };

  const handleDropArticle = async (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex || !articlesCollection) { setDragIndex(null); return; }
    const reordered = [...collectionArticles];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const prev = collectionArticles;
    setCollectionArticles(reordered);
    setDragIndex(null);
    try {
      const res = await adminClient.put(`/api/admin/dr/collections/${articlesCollection.collectionId}/articles/reorder`, { articleIds: reordered.map((a) => a.articleId) });
      if (res.data.code === 200) message.success("排序已更新");
      else { setCollectionArticles(prev); message.error("排序更新失败"); }
    } catch { setCollectionArticles(prev); message.error("排序更新失败"); }
  };

  const columns = [
    { title: "封面", dataIndex: "coverUrl", key: "coverUrl", width: 60, align: "center" as const, render: (v: string) => v ? <img src={v} alt="cover" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} /> : <span style={{ color: "#ddd", fontSize: 11 }}>无</span> },
    { title: "集合名称", dataIndex: "name", key: "name", width: 160 },
    { title: "描述", dataIndex: "description", key: "description", render: (v: string) => v || <span style={{ color: "#ccc" }}>-</span> },
    { title: "Collection ID", dataIndex: "collectionId", key: "collectionId", width: 170, render: (v: string) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{v}</span> },
    { title: "文章数", dataIndex: "articleCount", key: "articleCount", width: 80, align: "center" as const, render: (v: number) => <Tag color={v > 0 ? "blue" : "default"}>{v}</Tag> },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: (v: string) => new Date(v).toLocaleString("zh-CN") },
    {
      title: "操作", key: "actions", width: 160,
      render: (_: unknown, r: CollectionRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => handleViewArticles(r)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}><UnorderedListOutlined /> 文章</span>
          <span onClick={() => openEdit(r)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}><EditOutlined /> 编辑</span>
          <span onClick={() => handleDelete(r)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}><DeleteOutlined /></span>
        </div>
      ),
    },
  ];

  const articleColumns = [
    { title: "", key: "drag", width: 36, align: "center" as const, render: () => <HolderOutlined style={{ color: "#bbb", cursor: "grab" }} /> },
    { title: "封面", key: "coverUrl", width: 56, align: "center" as const, render: (_: unknown, item: CollectionArticleItem) => item.article?.coverUrl ? <img src={item.article.coverUrl} alt="cover" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} /> : <span style={{ color: "#ddd", fontSize: 11 }}>无</span> },
    { title: "文章标题", key: "title", render: (_: unknown, item: CollectionArticleItem) => item.article?.title || item.articleId },
    { title: "作者", key: "author", width: 100, render: (_: unknown, item: CollectionArticleItem) => item.article?.author || <span style={{ color: "#ccc" }}>-</span> },
    { title: "加入时间", dataIndex: "addedAt", key: "addedAt", width: 160, render: (v: string) => new Date(v).toLocaleString("zh-CN") },
    { title: "操作", key: "actions", width: 80, render: (_: unknown, item: CollectionArticleItem) => (<Popconfirm title="确认移除该文章？" onConfirm={() => handleRemoveArticle(item.articleId)} okText="移除" cancelText="取消" okButtonProps={{ danger: true }}><span style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}><MinusCircleOutlined /> 移除</span></Popconfirm>) },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#999" }}>共 {collections.length} 个集合</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 4 }}>新建集合</Button>
      </div>
      {loading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin /></div> : <Table dataSource={collections} columns={columns} rowKey="collectionId" pagination={false} size="small" />}

      <Modal title={editing ? "编辑集合" : "新建集合"} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave} okText="保存" cancelText="取消" confirmLoading={saving}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>集合名称 *</div><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="请输入集合名称" /></div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>描述</div><Input.TextArea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="请输入集合描述" rows={2} /></div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>封面图片 URL</div>
            <Input value={formCoverUrl} onChange={(e) => setFormCoverUrl(e.target.value)} placeholder="https://example.com/cover.jpg" />
            {formCoverUrl && <img src={formCoverUrl} alt="preview" style={{ marginTop: 8, width: 80, height: 80, objectFit: "cover", borderRadius: 4, border: "1px solid #f0f0f0" }} onError={(e) => (e.currentTarget.style.display = "none")} />}
          </div>
        </div>
      </Modal>

      <Drawer title={<Space><UnorderedListOutlined /><span>{articlesCollection?.name} 文章列表</span></Space>} open={articlesOpen} onClose={() => setArticlesOpen(false)} width={680} extra={<Button type="primary" icon={<PlusOutlined />} size="small" onClick={openAddArticle}>添加文章</Button>}>
        {articlesLoading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin /></div> : collectionArticles.length === 0 ? <div style={{ textAlign: "center", color: "#999", padding: 48 }}><UnorderedListOutlined style={{ fontSize: 32, marginBottom: 12, display: "block" }} />暂无文章</div> : (
          <>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 8 }}>拖动行可调整顺序，思维格栅将按此顺序展示文章。</div>
            <Table
              dataSource={collectionArticles}
              columns={articleColumns}
              rowKey="articleId"
              pagination={false}
              size="small"
              onRow={(_, index) => ({
                draggable: true,
                onDragStart: () => setDragIndex(index ?? null),
                onDragOver: (e) => e.preventDefault(),
                onDrop: () => handleDropArticle(index ?? 0),
                style: { cursor: "move" },
              })}
            />
          </>
        )}
      </Drawer>

      <Modal title={`向「${articlesCollection?.name}」添加文章`} open={addArticleOpen} onCancel={() => setAddArticleOpen(false)} onOk={handleAddArticle} okText="添加" cancelText="取消" confirmLoading={addingArticle}>
        <div style={{ padding: "12px 0" }}>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>选择文章</div>
          {loadingArticleOptions ? <div style={{ display: "flex", justifyContent: "center", padding: 12 }}><Spin size="small" /></div> : (
            <Select value={selectedArticleId || undefined} onChange={(v) => setSelectedArticleId(v)} style={{ width: "100%" }} placeholder="请搜索并选择文章" showSearch optionFilterProp="label" options={articleOptions.map((a) => ({ value: a.articleId, label: a.title }))} />
          )}
        </div>
      </Modal>
    </div>
  );
}

// ════════════════════════════════════════
// Tab: Articles
// ════════════════════════════════════════
function ArticlesTab({ spaceId }: { spaceId: string }) {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [filterChannelId, setFilterChannelId] = useState<string | undefined>(undefined);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ArticleDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formSummary, setFormSummary] = useState("");
  const [formAuthor, setFormAuthor] = useState("");
  const [formCoverUrl, setFormCoverUrl] = useState("");
  const [formChannelId, setFormChannelId] = useState<string | undefined>(undefined);
  const [formLayoutType, setFormLayoutType] = useState("default");
  const [formContent, setFormContent] = useState("");
  const [formContentType, setFormContentType] = useState("html");
  const [showContentTypeSwitch, setShowContentTypeSwitch] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  const [previewType, setPreviewType] = useState("html");
  const [previewTitle, setPreviewTitle] = useState("");
  const [aiBeautifyOpen, setAiBeautifyOpen] = useState(false);
  const [aiInputContent, setAiInputContent] = useState("");
  const [aiOutputHtml, setAiOutputHtml] = useState("");
  const [aiBeautifying, setAiBeautifying] = useState(false);

  const fetchChannels = useCallback(async () => {
    try { const res = await adminClient.get("/api/admin/dr/channels", { params: { space_id: spaceId } }); if (res.data.code === 200) setChannels(res.data.data.map((c: ChannelOption) => ({ channelId: c.channelId, name: c.name }))); }
    catch { /* ignore */ }
  }, [spaceId]);

  const fetchArticles = useCallback(async (p: number, channelId?: string) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: p, page_size: 20, space_id: spaceId };
      if (channelId) params.channel_id = channelId;
      const res = await adminClient.get("/api/admin/dr/articles", { params });
      if (res.data.code === 200) { setArticles(res.data.data.list); setTotal(res.data.data.total); }
    } catch { message.error("加载文章列表失败"); }
    finally { setLoading(false); }
  }, [spaceId]);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);
  useEffect(() => { fetchArticles(page, filterChannelId); }, [page, filterChannelId, fetchArticles]);

  const channelNameMap = new Map(channels.map((c) => [c.channelId, c.name]));

  const openCreate = () => {
    setEditing(null); setFormTitle(""); setFormSummary(""); setFormAuthor(""); setFormCoverUrl("");
    setFormChannelId(filterChannelId); setFormLayoutType("default"); setFormContent(""); setFormContentType("html");
    setShowContentTypeSwitch(false);
    setDrawerOpen(true);
  };

  const openEdit = async (r: ArticleRecord) => {
    setDrawerOpen(true); setShowContentTypeSwitch(false); setFormTitle(r.title); setFormSummary(r.summary); setFormAuthor(r.author);
    setFormCoverUrl(r.coverUrl); setFormChannelId(r.channelId); setFormLayoutType(r.layoutType);
    try {
      const res = await adminClient.get(`/api/admin/dr/articles/${r.articleId}`);
      if (res.data.code === 200) { setFormContent(res.data.data.content || ""); setFormContentType(res.data.data.contentType || "html"); setEditing(res.data.data); }
      else { setFormContent(""); setFormContentType("html"); setEditing({ ...r, content: "", contentType: "html" }); }
    } catch { setFormContent(""); setFormContentType("html"); setEditing({ ...r, content: "", contentType: "html" }); }
  };

  const handleSave = async () => {
    if (!formTitle.trim()) { message.error("标题不能为空"); return; }
    if (!formChannelId) { message.error("请选择频道"); return; }
    setSaving(true);
    try {
      const payload = { title: formTitle.trim(), summary: formSummary.trim(), author: formAuthor.trim(), coverUrl: formCoverUrl.trim(), spaceId, channelId: formChannelId, layoutType: formLayoutType, content: formContent, contentType: formContentType };
      if (editing) {
        const res = await adminClient.put(`/api/admin/dr/articles/${editing.articleId}`, payload);
        if (res.data.code === 200) { message.success("文章已更新"); setDrawerOpen(false); fetchArticles(page, filterChannelId); }
      } else {
        const res = await adminClient.post("/api/admin/dr/articles", payload);
        if (res.data.code === 200) { message.success("文章已创建"); setDrawerOpen(false); setPage(1); fetchArticles(1, filterChannelId); }
      }
    } catch { message.error("操作失败"); }
    finally { setSaving(false); }
  };

  const handleDelete = (r: ArticleRecord) => {
    Modal.confirm({
      title: "确认删除", content: `确定要删除文章「${r.title}」吗？此操作不可恢复。`,
      okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => { try { const res = await adminClient.delete(`/api/admin/dr/articles/${r.articleId}`); if (res.data.code === 200) { message.success("文章已删除"); fetchArticles(page, filterChannelId); } } catch { message.error("删除失败"); } },
    });
  };

  const handlePreview = async (r: ArticleRecord) => {
    setPreviewTitle(r.title); setPreviewContent("<p>正在加载内容...</p>"); setPreviewType("html"); setPreviewOpen(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/articles/${r.articleId}`);
      if (res.data.code === 200 && res.data.data.content) { setPreviewContent(res.data.data.content); setPreviewType(res.data.data.contentType || "html"); }
      else { setPreviewContent(`<p><b>摘要：</b>${r.summary || "暂无内容"}</p>`); setPreviewType("html"); }
    } catch { setPreviewContent(`<p><b>摘要：</b>${r.summary || "加载内容失败"}</p>`); setPreviewType("html"); }
  };

  const openAiBeautify = () => { setAiInputContent(formContent); setAiOutputHtml(""); setAiBeautifyOpen(true); };
  const handleAiBeautify = async () => {
    if (!aiInputContent.trim()) { message.warning("请先输入需要格式化的内容"); return; }
    setAiBeautifying(true);
    try { const res = await adminClient.post("/api/admin/ai/beautify", { content: aiInputContent }, { timeout: 180_000 }); if (res.data.code === 200) setAiOutputHtml(res.data.data.html); else message.error(res.data.message || "格式化失败"); }
    catch { message.error("AI 服务暂不可用"); }
    finally { setAiBeautifying(false); }
  };
  const handleApplyAiResult = () => { if (!aiOutputHtml) { message.warning("暂无格式化结果"); return; } setFormContent(aiOutputHtml); setFormContentType("html"); setAiBeautifyOpen(false); message.success("已回填到正文编辑框"); };

  const columns = [
    { title: "标题", dataIndex: "title", key: "title", width: 200, ellipsis: true },
    { title: "作者", dataIndex: "author", key: "author", width: 80 },
    { title: "频道", dataIndex: "channelId", key: "channelId", width: 100, render: (v: string) => channelNameMap.get(v) || v },
    { title: "布局", dataIndex: "layoutType", key: "layoutType", width: 70 },
    { title: "阅读数", dataIndex: "readCount", key: "readCount", width: 70, align: "center" as const },
    { title: "收藏数", dataIndex: "bookmarkCount", key: "bookmarkCount", width: 70, align: "center" as const },
    { title: "发布时间", dataIndex: "publishedAt", key: "publishedAt", width: 170, render: (v: string) => new Date(v).toLocaleString("zh-CN") },
    {
      title: "操作", key: "actions", width: 150,
      render: (_: unknown, r: ArticleRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => handlePreview(r)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}><EyeOutlined /></span>
          <span onClick={() => openEdit(r)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}><EditOutlined /> 编辑</span>
          <span onClick={() => handleDelete(r)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}><DeleteOutlined /></span>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#666" }}>频道：</span>
          <Select value={filterChannelId} onChange={(v) => { setFilterChannelId(v); setPage(1); }} allowClear placeholder="全部频道" style={{ width: 160 }} options={channels.map((c) => ({ value: c.channelId, label: c.name }))} />
          <span style={{ fontSize: 13, color: "#999" }}>共 {total} 篇</span>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 4 }}>新建文章</Button>
      </div>
      {loading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin /></div> : (
        <Table dataSource={articles} columns={columns} rowKey="articleId" size="small" pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: (t) => `共 ${t} 篇`, size: "small" }} />
      )}

      <Drawer title={editing ? "编辑文章" : "新建文章"} open={drawerOpen} onClose={() => setDrawerOpen(false)} width="100%" styles={{ body: { padding: 0 } }} extra={<Button type="primary" onClick={handleSave} loading={saving} style={{ borderRadius: 4 }}>保存</Button>}>
        <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
          {/* 左：实时手机预览 */}
          <div style={{ width: 540, flexShrink: 0, borderRight: "1px solid #f0f0f0", background: "#fafafa", overflow: "hidden", padding: "16px 12px", display: "flex", flexDirection: "column" }}>
            <MobilePreviewStage content={formContent} contentType={formContentType} debounceMs={400} />
          </div>
          {/* 右：录入表单 */}
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 880 }}>
              <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>标题 *</div><Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="文章标题" /></div>
              <div>
                <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>频道 *</div>
                <Select value={formChannelId} onChange={setFormChannelId} placeholder="选择频道" style={{ width: "100%" }} options={channels.map((c) => ({ value: c.channelId, label: c.name }))} />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>作者</div><Input value={formAuthor} onChange={(e) => setFormAuthor(e.target.value)} placeholder="作者名称" /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>布局类型</div>
                  <Select value={formLayoutType} onChange={setFormLayoutType} style={{ width: "100%" }} options={[{ value: "default", label: "默认" }, { value: "card", label: "卡片" }, { value: "wide", label: "宽幅" }]} />
                </div>
              </div>
              <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>摘要</div><Input.TextArea value={formSummary} onChange={(e) => setFormSummary(e.target.value)} placeholder="文章摘要" rows={2} /></div>
              <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>封面 URL</div><Input value={formCoverUrl} onChange={(e) => setFormCoverUrl(e.target.value)} placeholder="https://..." /></div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 13, color: "#666", userSelect: "none" }} onDoubleClick={() => setShowContentTypeSwitch((v) => !v)}>正文内容</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button size="small" icon={<ThunderboltOutlined />} onClick={openAiBeautify} style={{ borderRadius: 4, color: "#111", borderColor: "#d9d9d9", background: "#fff" }}>AI 格式美化</Button>
                    {showContentTypeSwitch && <Select value={formContentType} onChange={setFormContentType} size="small" options={[{ value: "html", label: "HTML" }, { value: "markdown", label: "Markdown" }]} />}
                  </div>
                </div>
                <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, overflow: "hidden" }}>
                  <Editor height="520px" language={formContentType === "markdown" ? "markdown" : "html"} value={formContent} onChange={(v) => setFormContent(v || "")} options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: "'SF Mono', 'Fira Code', 'Menlo', monospace", tabSize: 2, scrollBeyondLastLine: false, lineNumbers: "on", renderLineHighlight: "none", overviewRulerBorder: false, scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 }, padding: { top: 8, bottom: 8 }, wordWrap: "on" }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Drawer>

      <Modal title={previewTitle} open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={null} width={800} styles={{ body: { padding: "20px 0" } }}>
        <div style={{ padding: "0 24px", fontSize: 15, lineHeight: 1.8, color: "#333", maxHeight: "70vh", overflowY: "auto" }}>
          {previewType === "markdown" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown> : <div dangerouslySetInnerHTML={{ __html: previewContent }} />}
        </div>
      </Modal>

      <Modal title={<div style={{ display: "flex", alignItems: "center", gap: 8 }}><ThunderboltOutlined style={{ color: "#111" }} /><span>AI 格式美化</span></div>} open={aiBeautifyOpen} onCancel={() => setAiBeautifyOpen(false)} footer={null} width={960} styles={{ body: { padding: "16px 24px 24px" } }}>
        <div style={{ display: "flex", gap: 16, height: 680 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: "#666", fontWeight: 500 }}>输入内容</div>
            <Input.TextArea value={aiInputContent} onChange={(e) => setAiInputContent(e.target.value)} placeholder="粘贴需要格式化的原始文本内容..." style={{ flex: 1, resize: "none", fontSize: 13, lineHeight: 1.7, borderRadius: 6 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="primary" icon={<ThunderboltOutlined />} loading={aiBeautifying} onClick={handleAiBeautify} style={{ flex: 1, borderRadius: 6, background: "#111", borderColor: "#111", color: "#fff", height: 38 }}>{aiBeautifying ? "格式化中..." : "开始格式美化"}</Button>
              <Button onClick={handleApplyAiResult} disabled={!aiOutputHtml} style={{ flex: 1, borderRadius: 6, height: 38, borderColor: "#111", color: "#111", background: "#fff" }}>使用此结果</Button>
            </div>
          </div>
          <div style={{ width: 1, background: "#f0f0f0", flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "#666", fontWeight: 500, alignSelf: "flex-start" }}>手机预览</div>
            <div style={{ width: 320, height: 640, border: "2px solid #e0e0e0", borderRadius: 16, overflow: "hidden", background: "#fff", boxShadow: "0 4px 20px rgba(0,0,0,0.08)", flexShrink: 0 }}>
              <div style={{ height: "100%", overflowY: "auto", padding: "16px 14px", fontSize: 14, lineHeight: 1.8, color: "#333" }}>
                {aiOutputHtml ? <div dangerouslySetInnerHTML={{ __html: aiOutputHtml }} /> : <div style={{ color: "#bbb", fontSize: 13, textAlign: "center", paddingTop: 80 }}>格式化结果将在此预览</div>}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ════════════════════════════════════════
// Tab: Daily Picks (每日精选 + 思维格栅)
// ════════════════════════════════════════
function DailyPicksTab({ spaceId }: { spaceId: string }) {
  // ── 每日精选 state ──
  const [picks, setPicks] = useState<PickRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [articleOptions, setArticleOptions] = useState<ArticleOption[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [addReason, setAddReason] = useState("");
  const [loadingArticleOptions, setLoadingArticleOptions] = useState(false);
  const [addingArticle, setAddingArticle] = useState(false);
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [editingPick, setEditingPick] = useState<PickRecord | null>(null);
  const [editReason, setEditReason] = useState("");
  const [reasonSaving, setReasonSaving] = useState(false);

  // ── 编辑高亮 state ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentPick, setCurrentPick] = useState<PickRecord | null>(null);
  const [highlights, setHighlights] = useState<EditorHighlight[]>([]);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [hlModalOpen, setHlModalOpen] = useState(false);
  const [editingHighlight, setEditingHighlight] = useState<EditorHighlight | null>(null);
  const [hlText, setHlText] = useState("");
  const [hlNote, setHlNote] = useState("");
  const [hlColor, setHlColor] = useState("#FFD700");
  const [hlContextBefore, setHlContextBefore] = useState("");
  const [hlContextAfter, setHlContextAfter] = useState("");
  const [hlSaving, setHlSaving] = useState(false);

  // ── 思维格栅 state ──
  const [lattices, setLattices] = useState<LatticeConfig[]>([]);
  const [latticeLoading, setLatticeLoading] = useState(false);
  const [latticeModalOpen, setLatticeModalOpen] = useState(false);
  const [editingLattice, setEditingLattice] = useState<LatticeConfig | null>(null);
  const [collectionOptions, setCollectionOptions] = useState<CollectionOption[]>([]);
  const [latticeCollectionId, setLatticeCollectionId] = useState<string>("");
  const [latticeWeeklyTopic, setLatticeWeeklyTopic] = useState("");
  const [latticeRecommendation, setLatticeRecommendation] = useState("");
  const [latticeNodeNames, setLatticeNodeNames] = useState("");
  const [latticeCollectionArticles, setLatticeCollectionArticles] = useState<CollectionArticleItem[]>([]);
  const [latticeArticlesLoading, setLatticeArticlesLoading] = useState(false);
  const [latticeSaving, setLatticeSaving] = useState(false);

  // ── 每日精选 API ──
  const fetchPicks = useCallback(async () => {
    setLoading(true);
    try { const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/daily-picks`); if (res.data.code === 200) setPicks(res.data.data); }
    catch { message.error("加载精选列表失败"); }
    finally { setLoading(false); }
  }, [spaceId]);

  const fetchLattices = useCallback(async () => {
    setLatticeLoading(true);
    try { const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/daily-pick-lattice`); if (res.data.code === 200) setLattices(res.data.data ?? []); }
    catch { message.error("加载思维格栅列表失败"); }
    finally { setLatticeLoading(false); }
  }, [spaceId]);

  useEffect(() => { fetchPicks(); fetchLattices(); }, [fetchPicks, fetchLattices]);

  // 当前启用的精选 & 历史记录
  const currentPicked = picks.find((p) => p.enabled) ?? null;
  const historyPicks = picks.filter((p) => !p.enabled);

  // 当前启用的格栅 & 历史记录
  const currentLattice = lattices.find((l) => l.enabled) ?? null;
  const historyLattices = lattices.filter((l) => !l.enabled);

  const openAddModal = async () => {
    setSelectedArticleId(""); setAddReason(""); setAddModalOpen(true); setLoadingArticleOptions(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/articles?space_id=${spaceId}&page_size=200`);
      if (res.data.code === 200) setArticleOptions(res.data.data?.list ?? []);
    } catch { message.error("加载文章列表失败"); }
    finally { setLoadingArticleOptions(false); }
  };

  const handleAddArticle = async () => {
    if (!selectedArticleId) { message.error("请选择文章"); return; }
    setAddingArticle(true);
    try {
      const res = await adminClient.post(`/api/admin/dr/spaces/${spaceId}/daily-picks`, { articleId: selectedArticleId, reason: addReason.trim() });
      if (res.data.code === 200) { message.success("已设为当前每日精选"); setAddModalOpen(false); fetchPicks(); } else message.error(res.data.message || "添加失败");
    } catch { message.error("添加失败"); }
    finally { setAddingArticle(false); }
  };

  const handleActivatePick = async (r: PickRecord) => {
    try { const res = await adminClient.put(`/api/admin/dr/daily-picks/${r.pickId}/activate`); if (res.data.code === 200) { message.success("已设为当前每日精选"); fetchPicks(); } }
    catch { message.error("操作失败"); }
  };

  const handleDeletePick = (r: PickRecord) => {
    Modal.confirm({
      title: "确认删除", content: `确定要删除「${r.article?.title || r.articleId}」吗？`,
      okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => { try { const res = await adminClient.delete(`/api/admin/dr/daily-picks/${r.pickId}`); if (res.data.code === 200) { message.success("已删除"); fetchPicks(); } } catch { message.error("删除失败"); } },
    });
  };

  const openEditReason = (r: PickRecord) => { setEditingPick(r); setEditReason(r.reason || ""); setReasonModalOpen(true); };
  const handleSaveReason = async () => {
    if (!editingPick) return;
    setReasonSaving(true);
    try { const res = await adminClient.put(`/api/admin/dr/daily-picks/${editingPick.pickId}`, { reason: editReason.trim() }); if (res.data.code === 200) { message.success("已更新"); setReasonModalOpen(false); fetchPicks(); } }
    catch { message.error("更新失败"); }
    finally { setReasonSaving(false); }
  };

  // ── 编辑高亮 API ──
  const fetchHighlights = async (articleId: string) => {
    setHighlightsLoading(true);
    try { const res = await adminClient.get(`/api/admin/dr/articles/${articleId}/editor-highlights`); if (res.data.code === 200) setHighlights(res.data.data); }
    catch { message.error("加载高亮失败"); }
    finally { setHighlightsLoading(false); }
  };

  const openHighlightsDrawer = async (r: PickRecord) => { setCurrentPick(r); setDrawerOpen(true); await fetchHighlights(r.articleId); };
  const openAddHighlight = () => { setEditingHighlight(null); setHlText(""); setHlNote(""); setHlColor("#FFD700"); setHlContextBefore(""); setHlContextAfter(""); setHlModalOpen(true); };
  const openEditHighlight = (hl: EditorHighlight) => { setEditingHighlight(hl); setHlText(hl.text); setHlNote(hl.note); setHlColor(hl.color); setHlContextBefore(hl.contextBefore ?? ""); setHlContextAfter(hl.contextAfter ?? ""); setHlModalOpen(true); };

  const handleSaveHighlight = async () => {
    if (!hlText.trim()) { message.error("高亮文本不能为空"); return; }
    if (!currentPick) return;
    setHlSaving(true);
    try {
      if (editingHighlight) {
        const res = await adminClient.put(`/api/admin/dr/editor-highlights/${editingHighlight.highlightId}`, { text: hlText.trim(), note: hlNote.trim(), color: hlColor, contextBefore: hlContextBefore.trim(), contextAfter: hlContextAfter.trim() });
        if (res.data.code === 200) { message.success("高亮已更新"); setHlModalOpen(false); fetchHighlights(currentPick.articleId); fetchPicks(); }
      } else {
        const res = await adminClient.post(`/api/admin/dr/articles/${currentPick.articleId}/editor-highlights`, { text: hlText.trim(), note: hlNote.trim(), color: hlColor, contextBefore: hlContextBefore.trim(), contextAfter: hlContextAfter.trim() });
        if (res.data.code === 200) { message.success("高亮已创建"); setHlModalOpen(false); fetchHighlights(currentPick.articleId); fetchPicks(); }
      }
    } catch { message.error("保存失败"); }
    finally { setHlSaving(false); }
  };

  const handleDeleteHighlight = (hl: EditorHighlight) => {
    Modal.confirm({ title: "确认删除", content: "确定要删除此高亮吗？", okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => { try { const res = await adminClient.delete(`/api/admin/dr/editor-highlights/${hl.highlightId}`); if (res.data.code === 200) { message.success("已删除"); fetchHighlights(currentPick!.articleId); fetchPicks(); } } catch { message.error("删除失败"); } },
    });
  };

  // ── 思维格栅 API ──
  // overrideNodeNames=true 表示按合集顺序生成默认节点名（新建时或更换合集时使用）；
  // 编辑模式下首次加载传 false，保留原有节点名
  const loadLatticeCollectionArticles = async (collectionId: string, overrideNodeNames = true) => {
    setLatticeArticlesLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/collections/${collectionId}/articles`);
      if (res.data.code === 200) {
        const items = (res.data.data ?? []) as CollectionArticleItem[];
        setLatticeCollectionArticles(items);
        if (overrideNodeNames) {
          setLatticeNodeNames(
            buildDefaultNodeNames(items.map((item) => item.article?.title || item.articleId)).join("\n")
          );
        }
      }
    } catch {
      message.error("加载合集文章失败");
    } finally {
      setLatticeArticlesLoading(false);
    }
  };

  const openLatticeModal = async () => {
    setEditingLattice(null);
    setLatticeCollectionId("");
    setLatticeWeeklyTopic("");
    setLatticeRecommendation("");
    setLatticeNodeNames("");
    setLatticeCollectionArticles([]);
    setLatticeModalOpen(true);
    try { const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/collections`); if (res.data.code === 200) setCollectionOptions(res.data.data ?? []); }
    catch { message.error("加载合集列表失败"); }
  };

  const openEditLatticeModal = async (l: LatticeConfig) => {
    setEditingLattice(l);
    setLatticeCollectionId(l.collectionId);
    setLatticeWeeklyTopic(l.weeklyTopic ?? "");
    setLatticeRecommendation(l.recommendation ?? "");
    setLatticeNodeNames((l.nodeNames ?? []).join("\n"));
    setLatticeCollectionArticles([]);
    setLatticeModalOpen(true);
    try {
      const [colsRes] = await Promise.all([
        adminClient.get(`/api/admin/dr/spaces/${spaceId}/collections`),
        loadLatticeCollectionArticles(l.collectionId, false),
      ]);
      if (colsRes.data.code === 200) setCollectionOptions(colsRes.data.data ?? []);
    } catch { message.error("加载数据失败"); }
  };

  const handleChangeLatticeCollection = async (collectionId: string) => {
    setLatticeCollectionId(collectionId);
    setLatticeNodeNames("");
    setLatticeCollectionArticles([]);
    await loadLatticeCollectionArticles(collectionId);
  };

  const handleSaveLattice = async () => {
    if (!latticeCollectionId) { message.error("请选择合集"); return; }
    if (!latticeWeeklyTopic.trim()) { message.error("请填写本周议题"); return; }
    const nodeNames = latticeNodeNames
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (latticeCollectionArticles.length > 0 && nodeNames.length !== latticeCollectionArticles.length) {
      message.error(`节点名数量需与合集文章数一致（当前 ${latticeCollectionArticles.length} 篇）`);
      return;
    }
    if (nodeNames.length !== new Set(nodeNames).size) {
      message.error("同一个格栅中的节点名不能重复");
      return;
    }
    setLatticeSaving(true);
    try {
      if (editingLattice) {
        const res = await adminClient.put(`/api/admin/dr/daily-pick-lattice/${editingLattice.latticeId}`, {
          collectionId: latticeCollectionId,
          weeklyTopic: latticeWeeklyTopic.trim(),
          recommendation: latticeRecommendation.trim(),
          nodeNames,
        });
        if (res.data.code === 200) { message.success("已更新"); setLatticeModalOpen(false); fetchLattices(); }
        else message.error(res.data.message || "保存失败");
      } else {
        const res = await adminClient.post(`/api/admin/dr/spaces/${spaceId}/daily-pick-lattice`, {
          collectionId: latticeCollectionId,
          weeklyTopic: latticeWeeklyTopic.trim(),
          recommendation: latticeRecommendation.trim(),
          nodeNames,
        });
        if (res.data.code === 200) { message.success("已设为当前思维格栅"); setLatticeModalOpen(false); fetchLattices(); }
        else message.error(res.data.message || "保存失败");
      }
    } catch { message.error("保存失败"); }
    finally { setLatticeSaving(false); }
  };

  const handleActivateLattice = async (l: LatticeConfig) => {
    try { const res = await adminClient.put(`/api/admin/dr/daily-pick-lattice/${l.latticeId}/activate`); if (res.data.code === 200) { message.success("已设为当前思维格栅"); fetchLattices(); } }
    catch { message.error("操作失败"); }
  };

  const handleDeleteLattice = (l: LatticeConfig) => {
    Modal.confirm({ title: "确认删除", content: `确定要删除「${l.collection?.name || l.collectionId}」吗？`, okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => { try { const res = await adminClient.delete(`/api/admin/dr/daily-pick-lattice/${l.latticeId}`); if (res.data.code === 200) { message.success("已删除"); fetchLattices(); } } catch { message.error("删除失败"); } },
    });
  };

  // ── 高亮表格列 ──
  const highlightColumns = [
    { title: "高亮文本", dataIndex: "text", key: "text", render: (t: string) => <div style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</div> },
    { title: "备注", dataIndex: "note", key: "note", width: 150, render: (n: string) => n || <span style={{ color: "#ccc" }}>-</span> },
    { title: "颜色", dataIndex: "color", key: "color", width: 60, render: (c: string) => <div style={{ width: 20, height: 20, backgroundColor: c, borderRadius: 4, border: "1px solid #d9d9d9" }} /> },
    { title: "操作", key: "actions", width: 100, render: (_: unknown, r: EditorHighlight) => (<div style={{ display: "flex", gap: 12 }}><span onClick={() => openEditHighlight(r)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}><EditOutlined /></span><Popconfirm title="确认删除？" onConfirm={() => handleDeleteHighlight(r)} okText="删除" cancelText="取消"><span style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}><DeleteOutlined /></span></Popconfirm></div>) },
  ];

  // ── 历史精选表格列 ──
  const historyPickColumns = [
    { title: "封面", dataIndex: "article", key: "coverUrl", width: 60, align: "center" as const, render: (a: PickRecord["article"]) => a?.coverUrl ? <img src={a.coverUrl} alt="cover" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} /> : <span style={{ color: "#ddd", fontSize: 11 }}>无</span> },
    { title: "文章标题", dataIndex: "article", key: "title", render: (a: PickRecord["article"]) => a?.title || "-" },
    { title: "作者", dataIndex: "article", key: "author", width: 100, render: (a: PickRecord["article"]) => a?.author || <span style={{ color: "#ccc" }}>-</span> },
    { title: "高亮数", dataIndex: "highlightCount", key: "highlightCount", width: 70, align: "center" as const, render: (c: number) => <Tag color={c > 0 ? "gold" : "default"}>{c}</Tag> },
    { title: "推荐语", dataIndex: "reason", key: "reason", width: 180, render: (reason: string, r: PickRecord) => (<div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: reason ? "#333" : "#ccc", fontSize: 13 }}>{reason || "未填写"}</span><EditOutlined style={{ color: "#999", cursor: "pointer", fontSize: 12 }} onClick={() => openEditReason(r)} /></div>) },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 150, render: (t: string) => <span style={{ fontSize: 12, color: "#999" }}>{dayjs(t).format("YYYY-MM-DD HH:mm")}</span> },
    {
      title: "操作", key: "actions", width: 180,
      render: (_: unknown, r: PickRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => handleActivatePick(r)} style={{ color: "#1677ff", cursor: "pointer", fontSize: 13 }}><StarOutlined /> 设为当前</span>
          <span onClick={() => openHighlightsDrawer(r)} style={{ color: "#faad14", cursor: "pointer", fontSize: 13 }}><HighlightOutlined /> 高亮</span>
          <span onClick={() => handleDeletePick(r)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}><DeleteOutlined /></span>
        </div>
      ),
    },
  ];

  // ── 历史格栅表格列 ──
  const historyLatticeColumns = [
    { title: "封面", dataIndex: "collection", key: "coverUrl", width: 60, align: "center" as const, render: (c: LatticeConfig["collection"]) => c?.coverUrl ? <Avatar shape="square" size={36} src={c.coverUrl} /> : <span style={{ color: "#ddd", fontSize: 11 }}>无</span> },
    { title: "合集名称", dataIndex: "collection", key: "name", render: (c: LatticeConfig["collection"], r: LatticeConfig) => c?.name ?? r.collectionId },
    { title: "本周议题", dataIndex: "weeklyTopic", key: "weeklyTopic", width: 200, render: (t: string) => t || <span style={{ color: "#ccc" }}>-</span> },
    { title: "文章数", dataIndex: "articleCount", key: "articleCount", width: 80, align: "center" as const, render: (c: number) => c },
    { title: "推荐语", dataIndex: "recommendation", key: "recommendation", width: 200, render: (t: string) => t || <span style={{ color: "#ccc" }}>-</span> },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 150, render: (t: string) => <span style={{ fontSize: 12, color: "#999" }}>{dayjs(t).format("YYYY-MM-DD HH:mm")}</span> },
    {
      title: "操作", key: "actions", width: 200,
      render: (_: unknown, r: LatticeConfig) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => handleActivateLattice(r)} style={{ color: "#1677ff", cursor: "pointer", fontSize: 13 }}><StarOutlined /> 设为当前</span>
          <span onClick={() => openEditLatticeModal(r)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}><EditOutlined /> 编辑</span>
          <span onClick={() => handleDeleteLattice(r)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}><DeleteOutlined /></span>
        </div>
      ),
    },
  ];

  // ── 当前精选展示卡片 ──
  const renderCurrentPick = () => {
    if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Spin /></div>;
    if (!currentPicked) return <div style={{ color: "#999", textAlign: "center", padding: 24 }}>暂无当前每日精选，点击右上角「新增精选」</div>;
    const a = currentPicked.article;
    return (
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {a?.coverUrl && <img src={a.coverUrl} alt="cover" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6 }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{a?.title || currentPicked.articleId}</div>
          <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>{a?.author || "未知作者"}</div>
          {currentPicked.reason && <div style={{ color: "#faad14", fontSize: 13, marginTop: 4 }}>推荐语：{currentPicked.reason}</div>}
          <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
            <Tag color="gold">{currentPicked.highlightCount} 个高亮</Tag>
            <span onClick={() => openHighlightsDrawer(currentPicked)} style={{ color: "#faad14", cursor: "pointer", fontSize: 13 }}><HighlightOutlined /> 管理高亮</span>
            <span onClick={() => openEditReason(currentPicked)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}><EditOutlined /> 编辑推荐语</span>
          </div>
        </div>
      </div>
    );
  };

  // ── 当前格栅展示卡片 ──
  const renderCurrentLattice = () => {
    if (latticeLoading) return <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Spin /></div>;
    if (!currentLattice) return <div style={{ color: "#999", textAlign: "center", padding: 24 }}>暂无当前思维格栅，点击右上角「新增格栅」</div>;
    const c = currentLattice.collection;
    return (
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {c?.coverUrl && <Avatar shape="square" size={64} src={c.coverUrl} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{c?.name ?? currentLattice.collectionId}</div>
          {c?.description && <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>{c.description}</div>}
          {currentLattice.weeklyTopic && <div style={{ color: "#1677ff", fontSize: 13, marginTop: 4, fontWeight: 500 }}>本周议题：{currentLattice.weeklyTopic}</div>}
          {currentLattice.recommendation && <div style={{ color: "#722ed1", fontSize: 13, marginTop: 4 }}>推荐语：{currentLattice.recommendation}</div>}
          <div style={{ color: "#999", fontSize: 12, marginTop: 4 }}>共 {currentLattice.articleCount} 篇资源</div>
          {currentLattice.nodeNames.length > 0 && (
            <div style={{ color: "#999", fontSize: 12, marginTop: 4 }}>
              已配置 {currentLattice.nodeNames.length} 个节点名
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <span onClick={() => openEditLatticeModal(currentLattice)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
              <EditOutlined /> 编辑
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <Tabs
        defaultActiveKey="daily-pick"
        items={[
          {
            key: "daily-pick",
            label: <span><StarOutlined /> 每日精选</span>,
            children: (
              <div>
                {/* 当前精选 */}
                <Card
                  size="small"
                  title={<span style={{ fontWeight: 600 }}>当前精选</span>}
                  style={{ marginBottom: 16 }}
                  extra={<Button type="primary" icon={<PlusOutlined />} onClick={openAddModal} size="small">新增精选</Button>}
                >
                  {renderCurrentPick()}
                </Card>

                {/* 历史记录 */}
                <Card size="small" title={<span style={{ fontWeight: 600 }}>历史记录 ({historyPicks.length})</span>}>
                  {historyPicks.length === 0 ? (
                    <div style={{ color: "#999", textAlign: "center", padding: 24 }}>暂无历史记录</div>
                  ) : (
                    <Table dataSource={historyPicks} columns={historyPickColumns} rowKey="pickId" pagination={historyPicks.length > 10 ? { pageSize: 10, size: "small" } : false} size="small" />
                  )}
                </Card>
              </div>
            ),
          },
          {
            key: "lattice",
            label: <span><AppstoreOutlined /> 思维格栅</span>,
            children: (
              <div>
                {/* 当前格栅 */}
                <Card
                  size="small"
                  title={<span style={{ fontWeight: 600 }}>当前格栅</span>}
                  style={{ marginBottom: 16 }}
                  extra={<Button type="primary" icon={<PlusOutlined />} onClick={openLatticeModal} size="small">新增格栅</Button>}
                >
                  {renderCurrentLattice()}
                </Card>

                {/* 历史记录 */}
                <Card size="small" title={<span style={{ fontWeight: 600 }}>历史记录 ({historyLattices.length})</span>}>
                  {historyLattices.length === 0 ? (
                    <div style={{ color: "#999", textAlign: "center", padding: 24 }}>暂无历史记录</div>
                  ) : (
                    <Table dataSource={historyLattices} columns={historyLatticeColumns} rowKey="latticeId" pagination={historyLattices.length > 10 ? { pageSize: 10, size: "small" } : false} size="small" />
                  )}
                </Card>
              </div>
            ),
          },
        ]}
      />

      {/* 新增精选 Modal */}
      <Modal title="新增每日精选" open={addModalOpen} onCancel={() => setAddModalOpen(false)} onOk={handleAddArticle} okText="确定" cancelText="取消" confirmLoading={addingArticle}>
        <div style={{ padding: "12px 0" }}>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>选择文章</div>
          {loadingArticleOptions ? <div style={{ display: "flex", justifyContent: "center", padding: 12 }}><Spin size="small" /></div> : articleOptions.length === 0 ? <div style={{ color: "#999", padding: 12 }}>该空间下没有文章</div> : (
            <Select value={selectedArticleId || undefined} onChange={(v) => setSelectedArticleId(v)} style={{ width: "100%" }} placeholder="请搜索并选择文章" showSearch optionFilterProp="label" options={articleOptions.map((a) => ({ value: a.articleId, label: `${a.title} - ${a.author || "未知"}` }))} />
          )}
          <div style={{ fontSize: 13, color: "#666", marginBottom: 4, marginTop: 12 }}>推荐语（可选）</div>
          <Input value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder="填写推荐语" />
          {currentPicked && (
            <div style={{ marginTop: 12, padding: 8, background: "#fffbe6", borderRadius: 4, fontSize: 12, color: "#ad8b00" }}>
              新增后将替换当前精选「{currentPicked.article?.title}」，原精选将移入历史记录
            </div>
          )}
        </div>
      </Modal>

      {/* 编辑推荐语 Modal */}
      <Modal title="编辑推荐语" open={reasonModalOpen} onCancel={() => setReasonModalOpen(false)} onOk={handleSaveReason} okText="保存" cancelText="取消" confirmLoading={reasonSaving}>
        <div style={{ padding: "12px 0" }}><Input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="填写推荐语" /></div>
      </Modal>

      {/* 编辑高亮 Drawer */}
      <Drawer title={<Space><HighlightOutlined style={{ color: "#faad14" }} /><span>编辑高亮 - {currentPick?.article?.title || currentPick?.articleId}</span></Space>} open={drawerOpen} onClose={() => setDrawerOpen(false)} width={640} extra={<Button type="primary" icon={<PlusOutlined />} size="small" onClick={openAddHighlight}>添加高亮</Button>}>
        {highlightsLoading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin /></div> : highlights.length === 0 ? <div style={{ textAlign: "center", color: "#999", padding: 48 }}><HighlightOutlined style={{ fontSize: 32, marginBottom: 12, display: "block" }} />暂无编辑高亮</div> : <Table dataSource={highlights} columns={highlightColumns} rowKey="highlightId" pagination={false} size="small" />}
      </Drawer>

      {/* 添加/编辑高亮 Modal */}
      <Modal title={editingHighlight ? "编辑高亮" : "添加高亮"} open={hlModalOpen} onCancel={() => setHlModalOpen(false)} onOk={handleSaveHighlight} okText="保存" cancelText="取消" confirmLoading={hlSaving}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>高亮文本 *</div><Input.TextArea value={hlText} onChange={(e) => setHlText(e.target.value)} placeholder="请输入要高亮的文本内容" rows={3} /></div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>前文</div><Input.TextArea value={hlContextBefore} onChange={(e) => setHlContextBefore(e.target.value)} placeholder="可选：高亮文字前的原文" rows={2} /></div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>后文</div><Input.TextArea value={hlContextAfter} onChange={(e) => setHlContextAfter(e.target.value)} placeholder="可选：高亮文字后的原文" rows={2} /></div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>备注</div><Input value={hlNote} onChange={(e) => setHlNote(e.target.value)} placeholder="可选" /></div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>颜色</div><Select value={hlColor} onChange={setHlColor} style={{ width: "100%" }} options={[{ value: "#FFD700", label: "金色（推荐）" }, { value: "#FFEB3B", label: "黄色" }, { value: "#4CAF50", label: "绿色" }, { value: "#2196F3", label: "蓝色" }, { value: "#FF5722", label: "橙红色" }]} /></div>
        </div>
      </Modal>

      {/* 新增/编辑思维格栅 Modal */}
      <Modal title={editingLattice ? "编辑思维格栅" : "新增思维格栅"} open={latticeModalOpen} onCancel={() => setLatticeModalOpen(false)} onOk={handleSaveLattice} okText={editingLattice ? "保存" : "确定"} cancelText="取消" confirmLoading={latticeSaving}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>关联合集 *</div><Select value={latticeCollectionId || undefined} onChange={handleChangeLatticeCollection} style={{ width: "100%" }} placeholder="请选择合集" showSearch optionFilterProp="label" options={collectionOptions.map((c) => ({ value: c.collectionId, label: c.name }))} /></div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>本周议题 *</div>
            <Input value={latticeWeeklyTopic} onChange={(e) => setLatticeWeeklyTopic(e.target.value)} placeholder="例如：在 AI 时代如何保持深度思考" maxLength={80} showCount />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>节点名列表 *</div>
            <Input.TextArea
              value={latticeNodeNames}
              onChange={(e) => setLatticeNodeNames(e.target.value)}
              placeholder="选中合集后会按文章顺序自动生成默认节点名；每行一个"
              rows={6}
            />
            <div style={{ marginTop: 6, fontSize: 12, color: "#999" }}>
              {latticeArticlesLoading
                ? "正在读取合集文章..."
                : latticeCollectionArticles.length > 0
                  ? `当前合集共 ${latticeCollectionArticles.length} 篇文章，节点名会按当前顺序依次绑定`
                  : "请先选择合集"}
            </div>
          </div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>一句话推荐（可选）</div><Input value={latticeRecommendation} onChange={(e) => setLatticeRecommendation(e.target.value)} placeholder="填写推荐" /></div>
          {!editingLattice && currentLattice && (
            <div style={{ padding: 8, background: "#fffbe6", borderRadius: 4, fontSize: 12, color: "#ad8b00" }}>
              新增后将替换当前格栅「{currentLattice.collection?.name}」，原格栅将移入历史记录
            </div>
          )}
          {editingLattice && (
            <div style={{ padding: 8, background: "#e6f4ff", borderRadius: 4, fontSize: 12, color: "#0958d9" }}>
              正在编辑{editingLattice.enabled ? "当前" : "历史"}格栅，保存后{editingLattice.enabled ? "立即生效" : "仅修改该条历史记录"}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// ════════════════════════════════════════
// Tab: Homepage Modules
// ════════════════════════════════════════
function HomepageTab({ spaceId }: { spaceId: string }) {
  const [modules, setModules] = useState<HomepageModule[]>([]);
  const [loading, setLoading] = useState(false);
  const [moduleModalOpen, setModuleModalOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<HomepageModule | null>(null);
  const [moduleType, setModuleType] = useState("standard");
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleSubtitle, setModuleSubtitle] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [moduleLayoutType, setModuleLayoutType] = useState("large_horizontal");
  const [moduleSourceType, setModuleSourceType] = useState<"channel" | "collection">("channel");
  const [moduleSourceId, setModuleSourceId] = useState("");
  const [moduleSourceChannelOptions, setModuleSourceChannelOptions] = useState<ChannelOption[]>([]);
  const [moduleSourceCollectionOptions, setModuleSourceCollectionOptions] = useState<CollectionOption[]>([]);
  const [loadingSourceOptions, setLoadingSourceOptions] = useState(false);
  const [savingModule, setSavingModule] = useState(false);
  const [resourceModalOpen, setResourceModalOpen] = useState(false);
  const [resourceTargetModule, setResourceTargetModule] = useState<HomepageModule | null>(null);
  const [resourceType, setResourceType] = useState<"channel" | "article" | "collection">("channel");
  const [resourceId, setResourceId] = useState<string>("");
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [articleOptions, setArticleOptions] = useState<ArticleOption[]>([]);
  const [collectionOptions, setCollectionOptions] = useState<CollectionOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [addingResource, setAddingResource] = useState(false);

  const fetchModules = useCallback(async () => {
    setLoading(true);
    try { const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/homepage-modules`); if (res.data.code === 200) setModules(res.data.data); }
    catch { message.error("加载首页模块失败"); }
    finally { setLoading(false); }
  }, [spaceId]);

  useEffect(() => { fetchModules(); }, [fetchModules]);

  const loadModuleSourceOptions = async () => {
    setLoadingSourceOptions(true);
    try {
      const [chRes, colRes] = await Promise.all([adminClient.get(`/api/admin/dr/channels?space_id=${spaceId}`), adminClient.get(`/api/admin/dr/spaces/${spaceId}/collections`)]);
      if (chRes.data.code === 200) setModuleSourceChannelOptions(chRes.data.data ?? []);
      if (colRes.data.code === 200) setModuleSourceCollectionOptions(colRes.data.data ?? []);
    } catch { message.error("加载来源选项失败"); }
    finally { setLoadingSourceOptions(false); }
  };

  const openCreateModule = () => { setEditingModule(null); setModuleType("standard"); setModuleTitle(""); setModuleSubtitle(""); setModuleDescription(""); setModuleLayoutType("large_horizontal"); setModuleSourceType("channel"); setModuleSourceId(""); setModuleModalOpen(true); loadModuleSourceOptions(); };
  const openEditModule = (mod: HomepageModule) => { setEditingModule(mod); setModuleType(mod.moduleType || "standard"); setModuleTitle(mod.title); setModuleSubtitle(mod.subtitle); setModuleDescription(mod.description || ""); setModuleLayoutType(mod.layoutType || "large_horizontal"); setModuleSourceType((mod.sourceType as "channel" | "collection") || "channel"); setModuleSourceId(mod.sourceId || ""); setModuleModalOpen(true); loadModuleSourceOptions(); };

  const handleSaveModule = async () => {
    if (!moduleTitle.trim()) { message.error("模块标题不能为空"); return; }
    setSavingModule(true);
    try {
      if (editingModule) {
        const payload: Record<string, string> = { title: moduleTitle.trim() };
        if (moduleType !== "title_desc") { payload.subtitle = moduleSubtitle.trim(); payload.layoutType = moduleLayoutType; }
        if (moduleType === "title_desc") payload.description = moduleDescription.trim();
        if (moduleType === "load_list") { payload.sourceType = moduleSourceType; payload.sourceId = moduleSourceId; }
        const res = await adminClient.put(`/api/admin/dr/homepage-modules/${editingModule.moduleId}`, payload);
        if (res.data.code === 200) { message.success("模块已更新"); setModuleModalOpen(false); fetchModules(); }
      } else {
        if (moduleType === "load_list" && !moduleSourceId) { message.error("请选择来源"); setSavingModule(false); return; }
        const payload: Record<string, string> = { moduleType, title: moduleTitle.trim() };
        if (moduleType !== "title_desc") { payload.subtitle = moduleSubtitle.trim(); payload.layoutType = moduleLayoutType; }
        if (moduleType === "title_desc") payload.description = moduleDescription.trim();
        if (moduleType === "load_list") { payload.sourceType = moduleSourceType; payload.sourceId = moduleSourceId; }
        const res = await adminClient.post(`/api/admin/dr/spaces/${spaceId}/homepage-modules`, payload);
        if (res.data.code === 200) { message.success("模块已创建"); setModuleModalOpen(false); fetchModules(); }
      }
    } catch { message.error("操作失败"); }
    finally { setSavingModule(false); }
  };

  const handleDeleteModule = (mod: HomepageModule) => {
    Modal.confirm({ title: "确认删除模块", content: `确定要删除模块「${mod.title}」吗？`, okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => { try { const res = await adminClient.delete(`/api/admin/dr/homepage-modules/${mod.moduleId}`); if (res.data.code === 200) { message.success("模块已删除"); fetchModules(); } } catch { message.error("删除失败"); } },
    });
  };

  const handleMoveModule = async (index: number, direction: "up" | "down") => {
    const newModules = [...modules];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    [newModules[index], newModules[swapIndex]] = [newModules[swapIndex], newModules[index]];
    setModules(newModules);
    try { await adminClient.put(`/api/admin/dr/spaces/${spaceId}/homepage-modules/reorder`, { moduleIds: newModules.map((m) => m.moduleId) }); }
    catch { message.error("排序更新失败"); fetchModules(); }
  };

  const openAddResource = async (mod: HomepageModule) => {
    setResourceTargetModule(mod); setResourceType("channel"); setResourceId(""); setResourceModalOpen(true); setLoadingOptions(true);
    try {
      const [chRes, artRes, colRes] = await Promise.all([adminClient.get(`/api/admin/dr/channels?space_id=${spaceId}`), adminClient.get(`/api/admin/dr/articles?space_id=${spaceId}&page_size=200`), adminClient.get(`/api/admin/dr/spaces/${spaceId}/collections`)]);
      if (chRes.data.code === 200) setChannelOptions(chRes.data.data ?? []);
      if (artRes.data.code === 200) setArticleOptions(artRes.data.data?.list ?? []);
      if (colRes.data.code === 200) setCollectionOptions(colRes.data.data ?? []);
    } catch { message.error("加载资源选项失败"); }
    finally { setLoadingOptions(false); }
  };

  const handleAddResource = async () => {
    if (!resourceTargetModule || !resourceId) { message.error("请选择资源"); return; }
    setAddingResource(true);
    try { const res = await adminClient.post(`/api/admin/dr/homepage-modules/${resourceTargetModule.moduleId}/resources`, { resourceType, resourceId }); if (res.data.code === 200) { message.success("资源已添加"); setResourceModalOpen(false); fetchModules(); } }
    catch { message.error("添加失败"); }
    finally { setAddingResource(false); }
  };

  const handleRemoveResource = async (mod: HomepageModule, resId: string) => {
    try { const res = await adminClient.delete(`/api/admin/dr/homepage-modules/${mod.moduleId}/resources/${resId}`); if (res.data.code === 200) { message.success("资源已移除"); fetchModules(); } }
    catch { message.error("移除失败"); }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#999" }}>共 {modules.length} 个模块</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModule} style={{ borderRadius: 4 }}>添加模块</Button>
      </div>

      {loading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin /></div> : modules.length === 0 ? (
        <div style={{ textAlign: "center", color: "#999", padding: 48 }}><AppstoreOutlined style={{ fontSize: 32, marginBottom: 12, display: "block" }} />暂无首页模块</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {modules.map((mod, idx) => (
            <Card key={mod.moduleId} size="small" styles={{ header: { padding: "8px 16px" }, body: { padding: "12px 16px" } }}
              title={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <ArrowUpOutlined style={{ fontSize: 10, color: (idx === 0 || mod.moduleType === "load_list") ? "#ddd" : "#999", cursor: (idx === 0 || mod.moduleType === "load_list") ? "not-allowed" : "pointer" }} onClick={() => idx > 0 && mod.moduleType !== "load_list" && handleMoveModule(idx, "up")} />
                    <ArrowDownOutlined style={{ fontSize: 10, color: (idx === modules.length - 1 || mod.moduleType === "load_list" || modules[idx + 1]?.moduleType === "load_list") ? "#ddd" : "#999", cursor: (idx === modules.length - 1 || mod.moduleType === "load_list" || modules[idx + 1]?.moduleType === "load_list") ? "not-allowed" : "pointer" }} onClick={() => idx < modules.length - 1 && mod.moduleType !== "load_list" && modules[idx + 1]?.moduleType !== "load_list" && handleMoveModule(idx, "down")} />
                  </div>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{mod.title}</span>
                  {mod.moduleType === "title_desc" && <Tag color="gold" style={{ fontSize: 11 }}>标题描述</Tag>}
                  {mod.moduleType === "load_list" && <Tag color="volcano" style={{ fontSize: 11 }}>加载列表</Tag>}
                  {mod.subtitle && mod.moduleType !== "title_desc" && <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{mod.subtitle}</Text>}
                  {mod.moduleType !== "title_desc" && <Tag color={layoutColor(mod.layoutType)} style={{ marginLeft: 4, fontSize: 11 }}>{layoutLabel(mod.layoutType)}</Tag>}
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>#{idx + 1}</Text>
                </div>
              }
              extra={
                <Space size={8}>
                  {(!mod.moduleType || mod.moduleType === "standard") && <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => openAddResource(mod)}>绑定资源</Button>}
                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditModule(mod)} />
                  <Popconfirm title="确认删除模块" description={`将同时移除「${mod.title}」下所有资源绑定`} onConfirm={() => handleDeleteModule(mod)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}><Button type="text" size="small" icon={<DeleteOutlined />} danger /></Popconfirm>
                </Space>
              }
            >
              {mod.moduleType === "title_desc" ? (
                <div style={{ fontSize: 13, color: mod.description ? "#555" : "#bbb" }}>{mod.description || "暂无描述文本"}</div>
              ) : mod.moduleType === "load_list" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Tag color={mod.sourceType === "channel" ? "geekblue" : "purple"} style={{ fontSize: 11 }}>{mod.sourceType === "channel" ? "频道" : "集合"}</Tag>
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{mod.sourceId}</span>
                </div>
              ) : mod.resources.length === 0 ? (
                <div style={{ color: "#bbb", fontSize: 12 }}>暂未绑定资源</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {mod.resources.map((r) => {
                    const tagColor = r.resourceType === "channel" ? "geekblue" : r.resourceType === "collection" ? "purple" : "orange";
                    const tagLabel = r.resourceType === "channel" ? "频道" : r.resourceType === "collection" ? "集合" : "文章";
                    const detail = r.detail as Record<string, string> | null;
                    const displayName = detail ? (r.resourceType === "article" ? detail.title : detail.name) : r.resourceId;
                    return (
                      <div key={r.resourceId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", background: "#fafafa", borderRadius: 4, border: "1px solid #f0f0f0" }}>
                        <Tag color={tagColor} style={{ fontSize: 11, margin: 0 }}>{tagLabel}</Tag>
                        <span style={{ flex: 1, fontSize: 13, color: "#333" }}>{displayName}</span>
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: "#bbb" }}>{r.resourceId}</span>
                        <Popconfirm title="确认移除该资源？" onConfirm={() => handleRemoveResource(mod, r.resourceId)} okText="移除" cancelText="取消" okButtonProps={{ danger: true }}><MinusCircleOutlined style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }} /></Popconfirm>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Module Modal */}
      <Modal title={editingModule ? "编辑模块" : "添加首页模块"} open={moduleModalOpen} onCancel={() => setModuleModalOpen(false)} onOk={handleSaveModule} okText="保存" cancelText="取消" confirmLoading={savingModule}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 0" }}>
          {!editingModule && (
            <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>模块类型 *</div>
              <Select value={moduleType} onChange={(v) => { setModuleType(v); setModuleSourceId(""); }} style={{ width: "100%" }} options={[{ value: "standard", label: "标准模块（手动绑定资源）" }, { value: "title_desc", label: "标题描述" }, { value: "load_list", label: "加载列表（自动拉取频道/集合文章）" }]} />
            </div>
          )}
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>模块标题 *</div><Input value={moduleTitle} onChange={(e) => setModuleTitle(e.target.value)} placeholder="例如：推荐阅读" /></div>
          {moduleType === "title_desc" && <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>描述文本</div><Input.TextArea value={moduleDescription} onChange={(e) => setModuleDescription(e.target.value)} placeholder="展示在标题下方的描述内容" rows={3} /></div>}
          {moduleType !== "title_desc" && (
            <>
              <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>副标题（可选）</div><Input value={moduleSubtitle} onChange={(e) => setModuleSubtitle(e.target.value)} placeholder="例如：精选内容每日更新" /></div>
              <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>资源排列方式</div><Select value={moduleLayoutType} onChange={(v) => setModuleLayoutType(v)} style={{ width: "100%" }} options={LAYOUT_TYPES} /></div>
            </>
          )}
          {moduleType === "load_list" && (
            <>
              <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>来源类型 *</div><Select value={moduleSourceType} onChange={(v) => { setModuleSourceType(v); setModuleSourceId(""); }} style={{ width: "100%" }} options={[{ value: "channel", label: "频道" }, { value: "collection", label: "集合" }]} /></div>
              <div>
                <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>选择{moduleSourceType === "channel" ? "频道" : "集合"} *</div>
                {loadingSourceOptions ? <div style={{ display: "flex", justifyContent: "center", padding: 8 }}><Spin size="small" /></div> : (
                  <Select value={moduleSourceId || undefined} onChange={(v) => setModuleSourceId(v)} style={{ width: "100%" }} placeholder={`请选择${moduleSourceType === "channel" ? "频道" : "集合"}`} showSearch optionFilterProp="label"
                    options={moduleSourceType === "channel" ? moduleSourceChannelOptions.map((c) => ({ value: c.channelId, label: c.name })) : moduleSourceCollectionOptions.map((c) => ({ value: c.collectionId, label: c.name }))} />
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Add Resource Modal */}
      <Modal title={`绑定资源 — ${resourceTargetModule?.title}`} open={resourceModalOpen} onCancel={() => setResourceModalOpen(false)} onOk={handleAddResource} okText="绑定" cancelText="取消" confirmLoading={addingResource}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>资源类型</div>
            <Select value={resourceType} onChange={(v) => { setResourceType(v); setResourceId(""); }} style={{ width: "100%" }} options={[{ value: "channel", label: "频道" }, { value: "article", label: "文章" }, { value: "collection", label: "集合" }]} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>选择{resourceType === "channel" ? "频道" : resourceType === "collection" ? "集合" : "文章"}</div>
            {loadingOptions ? <div style={{ display: "flex", justifyContent: "center", padding: 12 }}><Spin size="small" /></div> : (
              <Select value={resourceId || undefined} onChange={(v) => setResourceId(v)} style={{ width: "100%" }} placeholder={`请选择${resourceType === "channel" ? "频道" : resourceType === "collection" ? "集合" : "文章"}`} showSearch optionFilterProp="label"
                options={resourceType === "channel" ? channelOptions.map((c) => ({ value: c.channelId, label: c.name })) : resourceType === "collection" ? collectionOptions.map((c) => ({ value: c.collectionId, label: c.name })) : articleOptions.map((a) => ({ value: a.articleId, label: a.title }))} />
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ════════════════════════════════════════
// Tab: Members
// ════════════════════════════════════════
function MembersTab({ spaceId }: { spaceId: string }) {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try { const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/members`); if (res.data.code === 200) setMembers(res.data.data); }
    catch { message.error("加载成员列表失败"); }
    finally { setLoading(false); }
  }, [spaceId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const columns = [
    { title: "手机号", dataIndex: "phone", key: "phone", width: 130 },
    { title: "昵称", dataIndex: "nickname", key: "nickname", width: 120 },
    { title: "角色", dataIndex: "role", key: "role", width: 80 },
    { title: "加入时间", dataIndex: "joinedAt", key: "joinedAt", render: (v: string) => new Date(v).toLocaleString("zh-CN") },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}><span style={{ fontSize: 13, color: "#999" }}>共 {members.length} 位成员</span></div>
      {loading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin /></div> : members.length === 0 ? <div style={{ textAlign: "center", color: "#999", padding: 48 }}>暂无成员</div> : <Table dataSource={members} columns={columns} rowKey="userId" pagination={false} size="small" />}
    </div>
  );
}

// ════════════════════════════════════════
// Tab: Invite Codes
// ════════════════════════════════════════
function InviteCodesTab({ spaceId }: { spaceId: string }) {
  const [codes, setCodes] = useState<InviteCodeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [codeLabel, setCodeLabel] = useState("");
  const [codeMaxUses, setCodeMaxUses] = useState<number | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<dayjs.Dayjs | null>(null);
  const [creating, setCreating] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [usersTitle, setUsersTitle] = useState("");
  const [codeUsers, setCodeUsers] = useState<InviteCodeUser[]>([]);

  const fetchCodes = useCallback(async () => {
    setLoading(true);
    try { const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/invite-codes`); if (res.data.code === 200) setCodes(res.data.data); }
    catch { message.error("加载邀请码失败"); }
    finally { setLoading(false); }
  }, [spaceId]);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const handleCopyCode = (code: string) => { navigator.clipboard.writeText(code).then(() => message.success("邀请码已复制"), () => message.error("复制失败")); };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await adminClient.post(`/api/admin/dr/spaces/${spaceId}/invite-codes`, { label: codeLabel.trim(), maxUses: codeMaxUses, expiresAt: codeExpiresAt ? codeExpiresAt.toISOString() : null });
      if (res.data.code === 200) { message.success("邀请码已创建"); setCreateOpen(false); setCodeLabel(""); setCodeMaxUses(null); setCodeExpiresAt(null); fetchCodes(); }
    } catch { message.error("创建失败"); }
    finally { setCreating(false); }
  };

  const handleDelete = (r: InviteCodeRecord) => {
    Modal.confirm({ title: "确认删除邀请码", content: `确定要删除邀请码「${r.code}」吗？`, okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => { try { const res = await adminClient.delete(`/api/admin/dr/invite-codes/${r.codeId}`); if (res.data.code === 200) { message.success("邀请码已删除"); fetchCodes(); } } catch { message.error("删除失败"); } },
    });
  };

  const handleViewUsers = (r: InviteCodeRecord) => { setUsersTitle(`邀请码 ${r.code} 的使用记录`); setCodeUsers(r.users); setUsersOpen(true); };

  const columns = [
    { title: "邀请码", dataIndex: "code", key: "code", width: 110, render: (v: string) => <span onClick={() => handleCopyCode(v)} style={{ fontFamily: "monospace", fontSize: 13, color: "#1890ff", cursor: "pointer" }}>{v} <CopyOutlined style={{ fontSize: 11 }} /></span> },
    { title: "备注", dataIndex: "label", key: "label", width: 120, render: (v: string) => v || <span style={{ color: "#ccc" }}>-</span> },
    { title: "使用情况", key: "usage", width: 100, render: (_: unknown, r: InviteCodeRecord) => <span>{r.maxUses !== null ? `${r.useCount}/${r.maxUses}` : `${r.useCount}/∞`}</span> },
    { title: "过期时间", dataIndex: "expiresAt", key: "expiresAt", width: 150, render: (v: string | null) => { if (!v) return <span style={{ color: "#ccc" }}>永久有效</span>; const expired = new Date(v) < new Date(); return <Tooltip title={new Date(v).toLocaleString("zh-CN")}><Tag color={expired ? "red" : "green"}>{expired ? "已过期" : new Date(v).toLocaleDateString("zh-CN")}</Tag></Tooltip>; } },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 150, render: (v: string) => new Date(v).toLocaleString("zh-CN") },
    { title: "操作", key: "actions", width: 120, render: (_: unknown, r: InviteCodeRecord) => (<div style={{ display: "flex", gap: 12 }}><span onClick={() => handleViewUsers(r)} style={{ color: r.useCount > 0 ? "#1890ff" : "#ccc", cursor: r.useCount > 0 ? "pointer" : "default", fontSize: 13 }}><UserOutlined /> {r.useCount}人</span><span onClick={() => handleDelete(r)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}><DeleteOutlined /></span></div>) },
  ];

  const userColumns = [
    { title: "手机号", dataIndex: "phone", key: "phone", width: 130 },
    { title: "昵称", dataIndex: "nickname", key: "nickname", width: 120 },
    { title: "加入时间", dataIndex: "joinedAt", key: "joinedAt", render: (v: string) => new Date(v).toLocaleString("zh-CN") },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#999" }}>共 {codes.length} 个邀请码</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} style={{ borderRadius: 4 }}>生成邀请码</Button>
      </div>
      {loading ? <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin /></div> : codes.length === 0 ? <div style={{ textAlign: "center", color: "#999", padding: 48 }}>暂无邀请码</div> : <Table dataSource={codes} columns={columns} rowKey="codeId" pagination={false} size="small" />}

      <Modal title="生成新邀请码" open={createOpen} onCancel={() => { setCreateOpen(false); setCodeLabel(""); setCodeMaxUses(null); setCodeExpiresAt(null); }} onOk={handleCreate} okText="生成" cancelText="取消" confirmLoading={creating}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>备注（可选）</div><Input value={codeLabel} onChange={(e) => setCodeLabel(e.target.value)} placeholder="例如：内测用户、VIP渠道" /></div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>最大使用次数（留空表示不限）</div><InputNumber value={codeMaxUses} onChange={(v) => setCodeMaxUses(v)} min={1} style={{ width: "100%" }} placeholder="不限制" /></div>
          <div><div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>过期时间（留空表示永久有效）</div><DatePicker value={codeExpiresAt} onChange={(v) => setCodeExpiresAt(v)} showTime style={{ width: "100%" }} placeholder="永久有效" /></div>
        </div>
      </Modal>

      <Modal title={usersTitle} open={usersOpen} onCancel={() => setUsersOpen(false)} footer={null} width={500}>
        {codeUsers.length === 0 ? <div style={{ textAlign: "center", color: "#999", padding: 24 }}>暂无使用记录</div> : <Table dataSource={codeUsers} columns={userColumns} rowKey="userId" pagination={false} size="small" />}
      </Modal>
    </div>
  );
}

// ════════════════════════════════════════
// Main: DrSpaceDetail
// ════════════════════════════════════════
export default function DrSpaceDetail() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "channels";

  const [space, setSpace] = useState<SpaceRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSpace = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const res = await adminClient.get("/api/admin/dr/spaces");
      if (res.data.code === 200) {
        const found = res.data.data.find((s: SpaceRecord) => s.spaceId === spaceId);
        setSpace(found || null);
      }
    } catch {
      message.error("加载空间信息失败");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => { fetchSpace(); }, [fetchSpace]);

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spin /></div>;
  if (!space) return <div style={{ textAlign: "center", color: "#999", padding: 48 }}>空间不存在</div>;

  const tabItems = [
    { key: "channels", label: <span><BranchesOutlined /> 频道</span>, children: <ChannelsTab spaceId={space.spaceId} /> },
    { key: "collections", label: <span><FolderOutlined /> 集合</span>, children: <CollectionsTab spaceId={space.spaceId} /> },
    { key: "articles", label: <span><ReadOutlined /> 文章</span>, children: <ArticlesTab spaceId={space.spaceId} /> },
    { key: "daily-picks", label: <span><StarOutlined /> 每日精选</span>, children: <DailyPicksTab spaceId={space.spaceId} /> },
    { key: "homepage", label: <span><AppstoreOutlined /> 首页配置</span>, children: <HomepageTab spaceId={space.spaceId} /> },
    { key: "invite-codes", label: <span><KeyOutlined /> 邀请码</span>, children: <InviteCodesTab spaceId={space.spaceId} /> },
    { key: "members", label: <span><TeamOutlined /> 成员</span>, children: <MembersTab spaceId={space.spaceId} /> },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <span onClick={() => navigate("/dr/spaces")} style={{ cursor: "pointer", color: "#999", fontSize: 14, display: "flex", alignItems: "center", gap: 4 }}>
          <ArrowLeftOutlined /> 空间列表
        </span>
        <span style={{ color: "#e0e0e0" }}>/</span>
        <span style={{ fontSize: 15, fontWeight: 500, color: "#333" }}>{space.name}</span>
        <span style={{ fontSize: 12, color: "#999", fontFamily: "monospace" }}>{space.spaceId}</span>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams({ tab: key })}
        items={tabItems}
      />
    </div>
  );
}
