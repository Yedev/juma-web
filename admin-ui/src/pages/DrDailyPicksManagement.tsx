import { useState, useEffect, useCallback } from "react";
import { message, Table, Modal, Select, Spin, Button, Tag, Drawer, Space, Popconfirm, Input, Card, Switch, Avatar } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, StarOutlined, HighlightOutlined, AppstoreOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface SpaceOption {
  spaceId: string;
  name: string;
}

interface PickRecord {
  id: number;
  pickId: string;
  spaceId: string;
  articleId: string;
  reason: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  article: {
    articleId: string;
    title: string;
    coverUrl: string;
    author: string;
    publishedAt: string;
  } | null;
  highlightCount: number;
}

interface EditorHighlight {
  highlightId: string;
  articleId: string;
  contextBefore?: string;
  contextAfter?: string;
  text: string;
  color: string;
  positionData: string;
  note: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface ArticleOption {
  articleId: string;
  title: string;
  author: string;
}

interface CollectionOption {
  collectionId: string;
  name: string;
  description: string;
  coverUrl: string;
}

interface LatticeConfig {
  latticeId: string;
  spaceId: string;
  collectionId: string;
  recommendation: string;
  enabled: boolean;
  collection: { collectionId: string; name: string; description: string; coverUrl: string } | null;
  articleCount: number;
}

export default function DrDailyPicksManagement() {
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | undefined>(undefined);
  const [picks, setPicks] = useState<PickRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Add article modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [articleOptions, setArticleOptions] = useState<ArticleOption[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [addReason, setAddReason] = useState("");
  const [loadingArticleOptions, setLoadingArticleOptions] = useState(false);

  // Edit reason modal
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [editingPick, setEditingPick] = useState<PickRecord | null>(null);
  const [editReason, setEditReason] = useState("");
  const [reasonSaving, setReasonSaving] = useState(false);
  const [addingArticle, setAddingArticle] = useState(false);

  // Editor highlights drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentPick, setCurrentPick] = useState<PickRecord | null>(null);
  const [highlights, setHighlights] = useState<EditorHighlight[]>([]);
  const [highlightsLoading, setHighlightsLoading] = useState(false);

  // Add/Edit highlight modal
  const [hlModalOpen, setHlModalOpen] = useState(false);
  const [editingHighlight, setEditingHighlight] = useState<EditorHighlight | null>(null);
  const [hlText, setHlText] = useState("");
  const [hlNote, setHlNote] = useState("");
  const [hlColor, setHlColor] = useState("#FFD700");
  const [hlContextBefore, setHlContextBefore] = useState("");
  const [hlContextAfter, setHlContextAfter] = useState("");
  const [hlSaving, setHlSaving] = useState(false);

  // Preview
  const [previewDate] = useState(new Date().toISOString().split("T")[0]);

  // 思维格栅
  const [lattice, setLattice] = useState<LatticeConfig | null>(null);
  const [latticeLoading, setLatticeLoading] = useState(false);
  const [latticeModalOpen, setLatticeModalOpen] = useState(false);
  const [collectionOptions, setCollectionOptions] = useState<CollectionOption[]>([]);
  const [latticeCollectionId, setLatticeCollectionId] = useState<string>("");
  const [latticeRecommendation, setLatticeRecommendation] = useState("");
  const [latticeSaving, setLatticeSaving] = useState(false);

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

  const fetchPicks = useCallback(async (spaceId?: string) => {
    if (!spaceId) {
      setPicks([]);
      return;
    }
    setLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/daily-picks`);
      if (res.data.code === 200) {
        setPicks(res.data.data);
      }
    } catch {
      message.error("加载精选列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLattice = useCallback(async (spaceId?: string) => {
    if (!spaceId) { setLattice(null); return; }
    setLatticeLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/daily-pick-lattice`);
      if (res.data.code === 200) setLattice(res.data.data);
    } catch {
      message.error("加载思维格栅配置失败");
    } finally {
      setLatticeLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpaces();
  }, [fetchSpaces]);

  useEffect(() => {
    fetchPicks(selectedSpaceId);
    fetchLattice(selectedSpaceId);
  }, [selectedSpaceId, fetchPicks, fetchLattice]);

  const openAddModal = async () => {
    if (!selectedSpaceId) return;
    setSelectedArticleId("");
    setAddReason("");
    setAddModalOpen(true);
    setLoadingArticleOptions(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/articles?space_id=${selectedSpaceId}&page_size=200`);
      if (res.data.code === 200) {
        // Filter out articles already in picks
        const existingIds = new Set(picks.map((p) => p.articleId));
        setArticleOptions((res.data.data?.list ?? []).filter((a: ArticleOption) => !existingIds.has(a.articleId)));
      }
    } catch {
      message.error("加载文章列表失败");
    } finally {
      setLoadingArticleOptions(false);
    }
  };

  const handleAddArticle = async () => {
    if (!selectedSpaceId || !selectedArticleId) {
      message.error("请选择文章");
      return;
    }
    setAddingArticle(true);
    try {
      const res = await adminClient.post(`/api/admin/dr/spaces/${selectedSpaceId}/daily-picks`, {
        articleId: selectedArticleId,
        reason: addReason.trim(),
      });
      if (res.data.code === 200) {
        message.success("文章已加入精选池");
        setAddModalOpen(false);
        fetchPicks(selectedSpaceId);
      } else {
        message.error(res.data.message || "添加失败");
      }
    } catch {
      message.error("添加失败");
    } finally {
      setAddingArticle(false);
    }
  };

  const openEditReason = (record: PickRecord) => {
    setEditingPick(record);
    setEditReason(record.reason || "");
    setReasonModalOpen(true);
  };

  const handleSaveReason = async () => {
    if (!editingPick) return;
    setReasonSaving(true);
    try {
      const res = await adminClient.put(`/api/admin/dr/daily-picks/${editingPick.pickId}`, {
        reason: editReason.trim(),
      });
      if (res.data.code === 200) {
        message.success("已更新");
        setReasonModalOpen(false);
        fetchPicks(selectedSpaceId);
      }
    } catch {
      message.error("更新失败");
    } finally {
      setReasonSaving(false);
    }
  };

  const handleToggle = async (record: PickRecord) => {
    try {
      const res = await adminClient.put(`/api/admin/dr/daily-picks/${record.pickId}/toggle`);
      if (res.data.code === 200) {
        message.success(res.data.message);
        fetchPicks(selectedSpaceId);
      }
    } catch {
      message.error("操作失败");
    }
  };

  const handleDelete = (record: PickRecord) => {
    Modal.confirm({
      title: "确认移除",
      content: `确定要将「${record.article?.title || record.articleId}」从精选池移除吗？`,
      okText: "移除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await adminClient.delete(`/api/admin/dr/daily-picks/${record.pickId}`);
          if (res.data.code === 200) {
            message.success("已移除");
            fetchPicks(selectedSpaceId);
          }
        } catch {
          message.error("移除失败");
        }
      },
    });
  };

  const openLatticeModal = async () => {
    if (!selectedSpaceId) return;
    setLatticeCollectionId(lattice?.collectionId ?? "");
    setLatticeRecommendation(lattice?.recommendation ?? "");
    setLatticeModalOpen(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/spaces/${selectedSpaceId}/collections`);
      if (res.data.code === 200) setCollectionOptions(res.data.data ?? []);
    } catch {
      message.error("加载合集列表失败");
    }
  };

  const handleSaveLattice = async () => {
    if (!selectedSpaceId || !latticeCollectionId) {
      message.error("请选择合集");
      return;
    }
    setLatticeSaving(true);
    try {
      const res = await adminClient.put(`/api/admin/dr/spaces/${selectedSpaceId}/daily-pick-lattice`, {
        collectionId: latticeCollectionId,
        recommendation: latticeRecommendation.trim(),
      });
      if (res.data.code === 200) {
        message.success("思维格栅已保存");
        setLatticeModalOpen(false);
        fetchLattice(selectedSpaceId);
      } else {
        message.error(res.data.message || "保存失败");
      }
    } catch {
      message.error("保存失败");
    } finally {
      setLatticeSaving(false);
    }
  };

  const handleToggleLattice = async () => {
    if (!selectedSpaceId) return;
    try {
      const res = await adminClient.put(`/api/admin/dr/spaces/${selectedSpaceId}/daily-pick-lattice/toggle`);
      if (res.data.code === 200) {
        message.success(res.data.message);
        fetchLattice(selectedSpaceId);
      }
    } catch {
      message.error("操作失败");
    }
  };

  const handleDeleteLattice = () => {
    Modal.confirm({
      title: "确认删除",
      content: "确定要删除思维格栅配置吗？",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await adminClient.delete(`/api/admin/dr/spaces/${selectedSpaceId}/daily-pick-lattice`);
          if (res.data.code === 200) {
            message.success("已删除");
            setLattice(null);
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const fetchHighlights = async (articleId: string) => {
    setHighlightsLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/articles/${articleId}/editor-highlights`);
      if (res.data.code === 200) {
        setHighlights(res.data.data);
      }
    } catch {
      message.error("加载高亮失败");
    } finally {
      setHighlightsLoading(false);
    }
  };

  const openHighlightsDrawer = async (record: PickRecord) => {
    setCurrentPick(record);
    setDrawerOpen(true);
    await fetchHighlights(record.articleId);
  };

  const openAddHighlight = () => {
    setEditingHighlight(null);
    setHlText("");
    setHlNote("");
    setHlColor("#FFD700");
    setHlContextBefore("");
    setHlContextAfter("");
    setHlModalOpen(true);
  };

  const openEditHighlight = (hl: EditorHighlight) => {
    setEditingHighlight(hl);
    setHlText(hl.text);
    setHlNote(hl.note);
    setHlColor(hl.color);
    setHlContextBefore(hl.contextBefore ?? "");
    setHlContextAfter(hl.contextAfter ?? "");
    setHlModalOpen(true);
  };

  const handleSaveHighlight = async () => {
    if (!hlText.trim()) {
      message.error("高亮文本不能为空");
      return;
    }
    if (!currentPick) return;

    setHlSaving(true);
    try {
      if (editingHighlight) {
        const res = await adminClient.put(`/api/admin/dr/editor-highlights/${editingHighlight.highlightId}`, {
          text: hlText.trim(),
          note: hlNote.trim(),
          color: hlColor,
          contextBefore: hlContextBefore.trim(),
          contextAfter: hlContextAfter.trim(),
        });
        if (res.data.code === 200) {
          message.success("高亮已更新");
          setHlModalOpen(false);
          fetchHighlights(currentPick.articleId);
          fetchPicks(selectedSpaceId);
        }
      } else {
        const res = await adminClient.post(`/api/admin/dr/articles/${currentPick.articleId}/editor-highlights`, {
          text: hlText.trim(),
          note: hlNote.trim(),
          color: hlColor,
          contextBefore: hlContextBefore.trim(),
          contextAfter: hlContextAfter.trim(),
        });
        if (res.data.code === 200) {
          message.success("高亮已创建");
          setHlModalOpen(false);
          fetchHighlights(currentPick.articleId);
          fetchPicks(selectedSpaceId);
        }
      }
    } catch {
      message.error("保存失败");
    } finally {
      setHlSaving(false);
    }
  };

  const handleDeleteHighlight = (hl: EditorHighlight) => {
    Modal.confirm({
      title: "确认删除",
      content: "确定要删除此高亮吗？",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await adminClient.delete(`/api/admin/dr/editor-highlights/${hl.highlightId}`);
          if (res.data.code === 200) {
            message.success("已删除");
            fetchHighlights(currentPick!.articleId);
            fetchPicks(selectedSpaceId);
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const columns = [
    {
      title: "封面",
      dataIndex: "article",
      key: "coverUrl",
      width: 60,
      align: "center" as const,
      render: (article: PickRecord["article"]) =>
        article?.coverUrl ? (
          <img src={article.coverUrl} alt="cover" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} />
        ) : (
          <span style={{ color: "#ddd", fontSize: 11 }}>无</span>
        ),
    },
    {
      title: "文章标题",
      dataIndex: "article",
      key: "title",
      width: 200,
      render: (article: PickRecord["article"]) => article?.title || "-",
    },
    {
      title: "作者",
      dataIndex: "article",
      key: "author",
      width: 100,
      render: (article: PickRecord["article"]) => article?.author || <span style={{ color: "#ccc" }}>-</span>,
    },
    {
      title: "高亮数",
      dataIndex: "highlightCount",
      key: "highlightCount",
      width: 80,
      align: "center" as const,
      render: (count: number) => <Tag color={count > 0 ? "gold" : "default"}>{count}</Tag>,
    },
    {
      title: "推荐语",
      dataIndex: "reason",
      key: "reason",
      render: (reason: string, record: PickRecord) => (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: reason ? "#333" : "#ccc", fontSize: 13 }}>{reason || "未填写"}</span>
          <EditOutlined style={{ color: "#999", cursor: "pointer", fontSize: 12 }} onClick={() => openEditReason(record)} />
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "enabled",
      key: "enabled",
      width: 80,
      align: "center" as const,
      render: (enabled: boolean) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "禁用"}</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_: unknown, record: PickRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => openHighlightsDrawer(record)} style={{ color: "#faad14", cursor: "pointer", fontSize: 13 }}>
            <HighlightOutlined /> 高亮
          </span>
          <span onClick={() => handleToggle(record)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            {record.enabled ? "禁用" : "启用"}
          </span>
          <span onClick={() => handleDelete(record)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}>
            <DeleteOutlined /> 移除
          </span>
        </div>
      ),
    },
  ];

  const highlightColumns = [
    {
      title: "高亮文本",
      dataIndex: "text",
      key: "text",
      render: (text: string) => (
        <div style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</div>
      ),
    },
    {
      title: "备注",
      dataIndex: "note",
      key: "note",
      width: 150,
      render: (note: string) => note || <span style={{ color: "#ccc" }}>-</span>,
    },
    {
      title: "颜色",
      dataIndex: "color",
      key: "color",
      width: 60,
      render: (color: string) => (
        <div style={{ width: 20, height: 20, backgroundColor: color, borderRadius: 4, border: "1px solid #d9d9d9" }} />
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_: unknown, record: EditorHighlight) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => openEditHighlight(record)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            <EditOutlined />
          </span>
          <Popconfirm title="确认删除？" onConfirm={() => handleDeleteHighlight(record)} okText="删除" cancelText="取消">
            <span style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}>
              <DeleteOutlined />
            </span>
          </Popconfirm>
        </div>
      ),
    },
  ];

  // 计算今日预览（简单的取前3个启用的文章）
  const todayPreview = picks.filter((p) => p.enabled && p.article).slice(0, 3);

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#666" }}>空间筛选：</span>
          <Select
            value={selectedSpaceId}
            onChange={setSelectedSpaceId}
            allowClear
            placeholder="请选择空间"
            style={{ width: 200 }}
            options={spaces.map((s) => ({ value: s.spaceId, label: s.name }))}
          />
          {selectedSpaceId && (
            <span style={{ fontSize: 13, color: "#999" }}>共 {picks.length} 篇精选文章</span>
          )}
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openAddModal}
          style={{ borderRadius: 4 }}
          disabled={!selectedSpaceId}
        >
          添加文章
        </Button>
      </div>

      {!selectedSpaceId ? (
        <div style={{ textAlign: "center", color: "#999", padding: 48 }}>请先选择空间</div>
      ) : loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : (
        <>
          <Table
            dataSource={picks}
            columns={columns}
            rowKey="pickId"
            pagination={false}
            size="small"
          />

          {/* 今日预览 */}
          <Card
            title={
              <Space>
                <StarOutlined style={{ color: "#faad14" }} />
                <span>今日预览 ({previewDate})</span>
              </Space>
            }
            size="small"
            style={{ marginTop: 16 }}
          >
            {todayPreview.length === 0 ? (
              <div style={{ color: "#999", textAlign: "center", padding: 12 }}>暂无启用的精选文章</div>
            ) : (
              <div>
                {todayPreview.map((p, idx) => (
                  <div key={p.pickId} style={{ padding: "4px 0", fontSize: 13 }}>
                    {idx + 1}. {p.article?.title} - {p.article?.author || "未知"}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 思维格栅 */}
          <Card
            title={
              <Space>
                <AppstoreOutlined style={{ color: "#722ed1" }} />
                <span>思维格栅</span>
              </Space>
            }
            size="small"
            style={{ marginTop: 16 }}
            extra={
              <Space>
                {lattice && (
                  <>
                    <Switch
                      size="small"
                      checked={lattice.enabled}
                      onChange={handleToggleLattice}
                      checkedChildren="启用"
                      unCheckedChildren="禁用"
                    />
                    <Button size="small" icon={<DeleteOutlined />} danger onClick={handleDeleteLattice} />
                  </>
                )}
                <Button size="small" type="primary" icon={lattice ? <EditOutlined /> : <PlusOutlined />} onClick={openLatticeModal}>
                  {lattice ? "编辑" : "配置"}
                </Button>
              </Space>
            }
          >
            {latticeLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 12 }}><Spin size="small" /></div>
            ) : !lattice ? (
              <div style={{ color: "#999", textAlign: "center", padding: 12 }}>
                暂未配置思维格栅，点击右上角「配置」关联一个合集
              </div>
            ) : (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                {lattice.collection?.coverUrl && (
                  <Avatar shape="square" size={56} src={lattice.collection.coverUrl} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{lattice.collection?.name ?? lattice.collectionId}</div>
                  {lattice.collection?.description && (
                    <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>{lattice.collection.description}</div>
                  )}
                  {lattice.recommendation && (
                    <div style={{ color: "#722ed1", fontSize: 12, marginTop: 4 }}>推荐语：{lattice.recommendation}</div>
                  )}
                  <div style={{ color: "#999", fontSize: 12, marginTop: 4 }}>共 {lattice.articleCount} 篇资源</div>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Add Article Modal */}
      <Modal
        title="添加文章到精选池"
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        onOk={handleAddArticle}
        okText="添加"
        cancelText="取消"
        confirmLoading={addingArticle}
      >
        <div style={{ padding: "12px 0" }}>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>选择文章</div>
          {loadingArticleOptions ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
              <Spin size="small" />
            </div>
          ) : articleOptions.length === 0 ? (
            <div style={{ color: "#999", padding: 12 }}>该空间下没有更多可添加的文章</div>
          ) : (
            <Select
              value={selectedArticleId || undefined}
              onChange={(v) => setSelectedArticleId(v)}
              style={{ width: "100%" }}
              placeholder="请搜索并选择文章"
              showSearch
              optionFilterProp="label"
              options={articleOptions.map((a) => ({ value: a.articleId, label: `${a.title} - ${a.author || "未知"}` }))}
            />
          )}
          <div style={{ fontSize: 13, color: "#666", marginBottom: 4, marginTop: 12 }}>推荐语（可选）</div>
          <Input
            value={addReason}
            onChange={(e) => setAddReason(e.target.value)}
            placeholder="填写推荐语，展示给用户"
          />
        </div>
      </Modal>

      {/* Edit Reason Modal */}
      <Modal
        title="编辑推荐语"
        open={reasonModalOpen}
        onCancel={() => setReasonModalOpen(false)}
        onOk={handleSaveReason}
        okText="保存"
        cancelText="取消"
        confirmLoading={reasonSaving}
      >
        <div style={{ padding: "12px 0" }}>
          <Input
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            placeholder="填写推荐语，展示给用户，留空则不展示"
          />
        </div>
      </Modal>

      {/* Editor Highlights Drawer */}
      <Drawer
        title={
          <Space>
            <HighlightOutlined style={{ color: "#faad14" }} />
            <span>编辑高亮 - {currentPick?.article?.title || currentPick?.articleId}</span>
          </Space>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={640}
        extra={
          <Button type="primary" icon={<PlusOutlined />} size="small" onClick={openAddHighlight}>
            添加高亮
          </Button>
        }
      >
        {highlightsLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
            <Spin />
          </div>
        ) : highlights.length === 0 ? (
          <div style={{ textAlign: "center", color: "#999", padding: 48 }}>
            <HighlightOutlined style={{ fontSize: 32, marginBottom: 12, display: "block" }} />
            暂无编辑高亮，点击右上角「添加高亮」
          </div>
        ) : (
          <Table
            dataSource={highlights}
            columns={highlightColumns}
            rowKey="highlightId"
            pagination={false}
            size="small"
          />
        )}
      </Drawer>

      {/* Add/Edit Highlight Modal */}
      <Modal
        title={editingHighlight ? "编辑高亮" : "添加高亮"}
        open={hlModalOpen}
        onCancel={() => setHlModalOpen(false)}
        onOk={handleSaveHighlight}
        okText="保存"
        cancelText="取消"
        confirmLoading={hlSaving}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>高亮文本 *</div>
            <Input.TextArea
              value={hlText}
              onChange={(e) => setHlText(e.target.value)}
              placeholder="请输入要高亮的文本内容"
              rows={3}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>前文（高亮前的原文片段）</div>
            <Input.TextArea
              value={hlContextBefore}
              onChange={(e) => setHlContextBefore(e.target.value)}
              placeholder="可选：填写高亮文字前的原文内容"
              rows={2}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>后文（高亮后的原文片段）</div>
            <Input.TextArea
              value={hlContextAfter}
              onChange={(e) => setHlContextAfter(e.target.value)}
              placeholder="可选：填写高亮文字后的原文内容"
              rows={2}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>备注</div>
            <Input
              value={hlNote}
              onChange={(e) => setHlNote(e.target.value)}
              placeholder="可选：添加推荐理由或说明"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>颜色</div>
            <Select
              value={hlColor}
              onChange={setHlColor}
              style={{ width: "100%" }}
              options={[
                { value: "#FFD700", label: "金色（推荐）" },
                { value: "#FFEB3B", label: "黄色" },
                { value: "#4CAF50", label: "绿色" },
                { value: "#2196F3", label: "蓝色" },
                { value: "#FF5722", label: "橙红色" },
              ]}
            />
          </div>
        </div>
      </Modal>
      {/* 思维格栅配置 Modal */}
      <Modal
        title="配置思维格栅"
        open={latticeModalOpen}
        onCancel={() => setLatticeModalOpen(false)}
        onOk={handleSaveLattice}
        okText="保存"
        cancelText="取消"
        confirmLoading={latticeSaving}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>关联合集 *</div>
            <Select
              value={latticeCollectionId || undefined}
              onChange={(v) => setLatticeCollectionId(v)}
              style={{ width: "100%" }}
              placeholder="请选择合集"
              showSearch
              optionFilterProp="label"
              options={collectionOptions.map((c) => ({ value: c.collectionId, label: c.name }))}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>一句话推荐（可选）</div>
            <Input
              value={latticeRecommendation}
              onChange={(e) => setLatticeRecommendation(e.target.value)}
              placeholder="填写对该合集的一句话推荐，展示给用户"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
