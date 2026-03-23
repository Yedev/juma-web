import { useState, useEffect, useCallback } from "react";
import { message, Table, Modal, Input, Select, Spin, Button, Tag, Drawer, Space, Popconfirm } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface SpaceOption {
  spaceId: string;
  name: string;
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

interface ArticleRecord {
  articleId: string;
  title: string;
  coverUrl: string;
  author: string;
  publishedAt: string;
}

interface CollectionArticleItem {
  collectionId: string;
  articleId: string;
  sortOrder: number;
  addedAt: string;
  article: ArticleRecord | null;
}

interface ArticleOption {
  articleId: string;
  title: string;
}

export default function DrCollectionManagement() {
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | undefined>(undefined);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Create/Edit collection modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CollectionRecord | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCoverUrl, setFormCoverUrl] = useState("");
  const [formSpaceId, setFormSpaceId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Articles drawer
  const [articlesOpen, setArticlesOpen] = useState(false);
  const [articlesCollection, setArticlesCollection] = useState<CollectionRecord | null>(null);
  const [collectionArticles, setCollectionArticles] = useState<CollectionArticleItem[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);

  // Add article modal
  const [addArticleOpen, setAddArticleOpen] = useState(false);
  const [articleOptions, setArticleOptions] = useState<ArticleOption[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [loadingArticleOptions, setLoadingArticleOptions] = useState(false);
  const [addingArticle, setAddingArticle] = useState(false);

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

  const fetchCollections = useCallback(async (spaceId?: string) => {
    if (!spaceId) {
      setCollections([]);
      return;
    }
    setLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/spaces/${spaceId}/collections`);
      if (res.data.code === 200) {
        setCollections(res.data.data);
      }
    } catch {
      message.error("加载集合列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpaces();
  }, [fetchSpaces]);

  useEffect(() => {
    fetchCollections(selectedSpaceId);
  }, [selectedSpaceId, fetchCollections]);

  const spaceNameMap = new Map(spaces.map((s) => [s.spaceId, s.name]));

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormDesc("");
    setFormCoverUrl("");
    setFormSpaceId(selectedSpaceId);
    setModalOpen(true);
  };

  const openEdit = (record: CollectionRecord) => {
    setEditing(record);
    setFormName(record.name);
    setFormDesc(record.description || "");
    setFormCoverUrl(record.coverUrl || "");
    setFormSpaceId(record.spaceId);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      message.error("集合名称不能为空");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const res = await adminClient.put(`/api/admin/dr/collections/${editing.collectionId}`, {
          name: formName.trim(),
          description: formDesc.trim(),
          coverUrl: formCoverUrl.trim(),
        });
        if (res.data.code === 200) {
          message.success("集合已更新");
          setModalOpen(false);
          fetchCollections(selectedSpaceId);
        }
      } else {
        if (!formSpaceId) {
          message.error("请选择所属空间");
          setSaving(false);
          return;
        }
        const res = await adminClient.post(`/api/admin/dr/spaces/${formSpaceId}/collections`, {
          name: formName.trim(),
          description: formDesc.trim(),
          coverUrl: formCoverUrl.trim(),
        });
        if (res.data.code === 200) {
          message.success("集合已创建");
          setModalOpen(false);
          fetchCollections(selectedSpaceId);
        }
      }
    } catch {
      message.error("操作失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (record: CollectionRecord) => {
    Modal.confirm({
      title: "确认删除",
      content: `确定要删除集合「${record.name}」吗？将同时移除该集合下所有文章关联。此操作不可恢复。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await adminClient.delete(`/api/admin/dr/collections/${record.collectionId}`);
          if (res.data.code === 200) {
            message.success("集合已删除");
            fetchCollections(selectedSpaceId);
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const fetchCollectionArticles = async (collectionId: string) => {
    setArticlesLoading(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/collections/${collectionId}/articles`);
      if (res.data.code === 200) setCollectionArticles(res.data.data);
    } catch {
      message.error("加载文章失败");
    } finally {
      setArticlesLoading(false);
    }
  };

  const handleViewArticles = async (record: CollectionRecord) => {
    setArticlesCollection(record);
    setArticlesOpen(true);
    await fetchCollectionArticles(record.collectionId);
  };

  const openAddArticle = async () => {
    if (!articlesCollection) return;
    setSelectedArticleId("");
    setAddArticleOpen(true);
    setLoadingArticleOptions(true);
    try {
      const res = await adminClient.get(`/api/admin/dr/articles?space_id=${articlesCollection.spaceId}&page_size=200`);
      if (res.data.code === 200) setArticleOptions(res.data.data?.list ?? []);
    } catch {
      message.error("加载文章列表失败");
    } finally {
      setLoadingArticleOptions(false);
    }
  };

  const handleAddArticle = async () => {
    if (!articlesCollection || !selectedArticleId) {
      message.error("请选择文章");
      return;
    }
    setAddingArticle(true);
    try {
      const res = await adminClient.post(`/api/admin/dr/collections/${articlesCollection.collectionId}/articles`, {
        articleId: selectedArticleId,
      });
      if (res.data.code === 200) {
        message.success("文章已加入集合");
        setAddArticleOpen(false);
        await fetchCollectionArticles(articlesCollection.collectionId);
      }
    } catch {
      message.error("添加失败");
    } finally {
      setAddingArticle(false);
    }
  };

  const handleRemoveArticle = async (articleId: string) => {
    if (!articlesCollection) return;
    try {
      const res = await adminClient.delete(
        `/api/admin/dr/collections/${articlesCollection.collectionId}/articles/${articleId}`
      );
      if (res.data.code === 200) {
        message.success("文章已移除");
        await fetchCollectionArticles(articlesCollection.collectionId);
      }
    } catch {
      message.error("移除失败");
    }
  };

  const columns = [
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
      title: "集合名称",
      dataIndex: "name",
      key: "name",
      width: 160,
    },
    {
      title: "描述",
      dataIndex: "description",
      key: "description",
      render: (v: string) => v || <span style={{ color: "#ccc" }}>-</span>,
    },
    {
      title: "Collection ID",
      dataIndex: "collectionId",
      key: "collectionId",
      width: 170,
      render: (v: string) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{v}</span>,
    },
    {
      title: "所属空间",
      dataIndex: "spaceId",
      key: "spaceId",
      width: 130,
      render: (v: string) => spaceNameMap.get(v) || v,
    },
    {
      title: "文章数",
      dataIndex: "articleCount",
      key: "articleCount",
      width: 80,
      align: "center" as const,
      render: (v: number) => <Tag color={v > 0 ? "blue" : "default"}>{v}</Tag>,
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
      width: 160,
      render: (_: unknown, record: CollectionRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span
            onClick={() => handleViewArticles(record)}
            style={{ color: "#666", cursor: "pointer", fontSize: 13 }}
          >
            <UnorderedListOutlined /> 文章
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

  const articleColumns = [
    {
      title: "封面",
      key: "coverUrl",
      width: 56,
      align: "center" as const,
      render: (_: unknown, item: CollectionArticleItem) =>
        item.article?.coverUrl ? (
          <img src={item.article.coverUrl} alt="cover" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} />
        ) : (
          <span style={{ color: "#ddd", fontSize: 11 }}>无</span>
        ),
    },
    {
      title: "文章标题",
      key: "title",
      render: (_: unknown, item: CollectionArticleItem) => item.article?.title || item.articleId,
    },
    {
      title: "作者",
      key: "author",
      width: 100,
      render: (_: unknown, item: CollectionArticleItem) =>
        item.article?.author || <span style={{ color: "#ccc" }}>-</span>,
    },
    {
      title: "加入时间",
      dataIndex: "addedAt",
      key: "addedAt",
      width: 160,
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      width: 80,
      render: (_: unknown, item: CollectionArticleItem) => (
        <Popconfirm
          title="确认移除该文章？"
          onConfirm={() => handleRemoveArticle(item.articleId)}
          okText="移除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <span style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 13 }}>
            <MinusCircleOutlined /> 移除
          </span>
        </Popconfirm>
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
            placeholder="请选择空间"
            style={{ width: 200 }}
            options={spaces.map((s) => ({ value: s.spaceId, label: s.name }))}
          />
          {selectedSpaceId && (
            <span style={{ fontSize: 13, color: "#999" }}>共 {collections.length} 个集合</span>
          )}
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
          style={{ borderRadius: 4 }}
          disabled={!selectedSpaceId}
        >
          新建集合
        </Button>
      </div>

      {!selectedSpaceId ? (
        <div style={{ textAlign: "center", color: "#999", padding: 48 }}>请先选择空间</div>
      ) : loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : (
        <Table
          dataSource={collections}
          columns={columns}
          rowKey="collectionId"
          pagination={false}
          size="small"
        />
      )}

      {/* Create/Edit Collection Modal */}
      <Modal
        title={editing ? "编辑集合" : "新建集合"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>集合名称 *</div>
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="请输入集合名称"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>描述</div>
            <Input.TextArea
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder="请输入集合描述"
              rows={2}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>封面图片 URL</div>
            <Input
              value={formCoverUrl}
              onChange={(e) => setFormCoverUrl(e.target.value)}
              placeholder="https://example.com/cover.jpg"
            />
            {formCoverUrl && (
              <img
                src={formCoverUrl}
                alt="preview"
                style={{ marginTop: 8, width: 80, height: 80, objectFit: "cover", borderRadius: 4, border: "1px solid #f0f0f0" }}
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            )}
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
        </div>
      </Modal>

      {/* Collection Articles Drawer */}
      <Drawer
        title={
          <Space>
            <UnorderedListOutlined />
            <span>「{articlesCollection?.name}」文章列表</span>
          </Space>
        }
        open={articlesOpen}
        onClose={() => setArticlesOpen(false)}
        width={680}
        extra={
          <Button type="primary" icon={<PlusOutlined />} size="small" onClick={openAddArticle}>
            添加文章
          </Button>
        }
      >
        {articlesLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
            <Spin />
          </div>
        ) : collectionArticles.length === 0 ? (
          <div style={{ textAlign: "center", color: "#999", padding: 48 }}>
            <UnorderedListOutlined style={{ fontSize: 32, marginBottom: 12, display: "block" }} />
            暂无文章，点击右上角「添加文章」
          </div>
        ) : (
          <Table
            dataSource={collectionArticles}
            columns={articleColumns}
            rowKey="articleId"
            pagination={false}
            size="small"
          />
        )}
      </Drawer>

      {/* Add Article Modal */}
      <Modal
        title={`向「${articlesCollection?.name}」添加文章`}
        open={addArticleOpen}
        onCancel={() => setAddArticleOpen(false)}
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
          ) : (
            <Select
              value={selectedArticleId || undefined}
              onChange={(v) => setSelectedArticleId(v)}
              style={{ width: "100%" }}
              placeholder="请搜索并选择文章"
              showSearch
              optionFilterProp="label"
              options={articleOptions.map((a) => ({ value: a.articleId, label: a.title }))}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
