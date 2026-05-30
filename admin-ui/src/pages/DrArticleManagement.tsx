import { useState, useEffect, useCallback } from "react";
import { message, Table, Modal, Input, Select, Spin, Button, Drawer } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, ThunderboltOutlined, MobileOutlined } from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { adminClient } from "../api/client";

// ── 通用手机预览弹窗 ────────────────────────────────────────
function MobilePreviewModal({
  open,
  onClose,
  title,
  content,
  contentType = "html",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  content: string;
  contentType?: string;
}) {
  return (
    <Modal
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MobileOutlined />
          <span>{title || "手机预览"}</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={400}
      styles={{ body: { display: "flex", justifyContent: "center", padding: "16px 0 24px" } }}
    >
      <div
        style={{
          width: 320,
          height: 640,
          border: "2px solid #e0e0e0",
          borderRadius: 16,
          overflow: "hidden",
          background: "#fff",
          boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            height: "100%",
            overflowY: "auto",
            padding: "16px 14px",
            fontSize: 14,
            lineHeight: 1.8,
            color: "#333",
          }}
        >
          {contentType === "markdown" ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: content }} />
          )}
        </div>
      </div>
    </Modal>
  );
}

interface SpaceOption {
  spaceId: string;
  name: string;
}

interface ChannelOption {
  channelId: string;
  name: string;
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

export default function DrArticleManagement() {
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [filterSpaceId, setFilterSpaceId] = useState<string | undefined>(undefined);
  const [filterChannelId, setFilterChannelId] = useState<string | undefined>(undefined);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ArticleDetail | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formTitle, setFormTitle] = useState("");
  const [formSummary, setFormSummary] = useState("");
  const [formAuthor, setFormAuthor] = useState("");
  const [formCoverUrl, setFormCoverUrl] = useState("");
  const [formSpaceId, setFormSpaceId] = useState<string | undefined>(undefined);
  const [formChannelId, setFormChannelId] = useState<string | undefined>(undefined);
  const [formLayoutType, setFormLayoutType] = useState("default");
  const [formContent, setFormContent] = useState("");
  const [formContentType, setFormContentType] = useState("html");
  const [showContentTypeSwitch, setShowContentTypeSwitch] = useState(false);
  const [formHighlights, setFormHighlights] = useState("");
  const [formChannels, setFormChannels] = useState<ChannelOption[]>([]);

  // Preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  const [previewType, setPreviewType] = useState("html");
  const [previewTitle, setPreviewTitle] = useState("");

  // AI 格式美化
  const [aiBeautifyOpen, setAiBeautifyOpen] = useState(false);
  const [aiInputContent, setAiInputContent] = useState("");
  const [aiOutputHtml, setAiOutputHtml] = useState("");
  const [aiBeautifying, setAiBeautifying] = useState(false);

  // 通用手机预览
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

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

  const fetchChannelsForSpace = useCallback(async (spaceId: string) => {
    try {
      const res = await adminClient.get("/api/admin/dr/channels", { params: { space_id: spaceId } });
      if (res.data.code === 200) {
        return res.data.data.map((c: ChannelOption) => ({ channelId: c.channelId, name: c.name }));
      }
    } catch {
      // ignore
    }
    return [];
  }, []);

  const fetchArticles = useCallback(async (p: number, spaceId?: string, channelId?: string) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: p, page_size: 20 };
      if (spaceId) params.space_id = spaceId;
      if (channelId) params.channel_id = channelId;
      const res = await adminClient.get("/api/admin/dr/articles", { params });
      if (res.data.code === 200) {
        setArticles(res.data.data.list);
        setTotal(res.data.data.total);
      }
    } catch {
      message.error("加载文章列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpaces();
  }, [fetchSpaces]);

  // Load channels when filter space changes
  useEffect(() => {
    if (filterSpaceId) {
      fetchChannelsForSpace(filterSpaceId).then(setChannels);
    } else {
      setChannels([]);
    }
    setFilterChannelId(undefined);
  }, [filterSpaceId, fetchChannelsForSpace]);

  useEffect(() => {
    fetchArticles(page, filterSpaceId, filterChannelId);
  }, [page, filterSpaceId, filterChannelId, fetchArticles]);

  const spaceNameMap = new Map(spaces.map((s) => [s.spaceId, s.name]));
  const channelNameMap = new Map(channels.map((c) => [c.channelId, c.name]));

  const openCreate = () => {
    setEditing(null);
    setFormTitle("");
    setFormSummary("");
    setFormAuthor("");
    setFormCoverUrl("");
    setFormSpaceId(filterSpaceId);
    setFormChannelId(filterChannelId);
    setFormLayoutType("default");
    setFormContent("");
    setFormContentType("html");
    setShowContentTypeSwitch(false);
    setFormHighlights("");
    if (filterSpaceId) {
      fetchChannelsForSpace(filterSpaceId).then(setFormChannels);
    } else {
      setFormChannels([]);
    }
    setDrawerOpen(true);
  };

  const openEdit = async (record: ArticleRecord) => {
    setDrawerOpen(true);
    setShowContentTypeSwitch(false);
    setFormTitle(record.title);
    setFormSummary(record.summary);
    setFormAuthor(record.author);
    setFormCoverUrl(record.coverUrl);
    setFormSpaceId(record.spaceId);
    setFormChannelId(record.channelId);
    setFormLayoutType(record.layoutType);

    const chs = await fetchChannelsForSpace(record.spaceId);
    setFormChannels(chs);

    // Fetch full article to get content
    try {
      const res = await adminClient.get(`/api/admin/dr/articles/${record.articleId}`);
      if (res.data.code === 200) {
        const detail = res.data.data;
        setFormContent(detail.content || "");
        setFormContentType(detail.contentType || "html");
        const hl = typeof detail.highlights === "string" ? JSON.parse(detail.highlights || "[]") : detail.highlights || [];
        setFormHighlights(Array.isArray(hl) && hl.length > 0 ? hl.join("\n") : "");
        setEditing(detail);
      } else {
        setFormContent("");
        setFormContentType("html");
        setFormHighlights("");
        setEditing({ ...record, content: "", contentType: "html" });
      }
    } catch {
      setFormContent("");
      setFormContentType("html");
      setFormHighlights("");
      setEditing({ ...record, content: "", contentType: "html" });
    }
  };

  const handleSave = async () => {
    if (!formTitle.trim()) {
      message.error("标题不能为空");
      return;
    }
    if (!formSpaceId || !formChannelId) {
      message.error("请选择空间和频道");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: formTitle.trim(),
        summary: formSummary.trim(),
        author: formAuthor.trim(),
        coverUrl: formCoverUrl.trim(),
        spaceId: formSpaceId,
        channelId: formChannelId,
        layoutType: formLayoutType,
        content: formContent,
        contentType: formContentType,
        highlights: formHighlights.trim() ? formHighlights.trim().split("\n").filter(Boolean) : [],
      };

      if (editing) {
        const res = await adminClient.put(`/api/admin/dr/articles/${editing.articleId}`, payload);
        if (res.data.code === 200) {
          message.success("文章已更新");
          setDrawerOpen(false);
          fetchArticles(page, filterSpaceId, filterChannelId);
        }
      } else {
        const res = await adminClient.post("/api/admin/dr/articles", payload);
        if (res.data.code === 200) {
          message.success("文章已创建");
          setDrawerOpen(false);
          setPage(1);
          fetchArticles(1, filterSpaceId, filterChannelId);
        }
      }
    } catch {
      message.error("操作失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (record: ArticleRecord) => {
    Modal.confirm({
      title: "确认删除",
      content: `确定要删除文章「${record.title}」吗？此操作不可恢复。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await adminClient.delete(`/api/admin/dr/articles/${record.articleId}`);
          if (res.data.code === 200) {
            message.success("文章已删除");
            fetchArticles(page, filterSpaceId, filterChannelId);
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const handlePreview = async (record: ArticleRecord) => {
    setPreviewTitle(record.title);
    setPreviewContent("<p>正在加载内容...</p>");
    setPreviewType("html");
    setPreviewOpen(true);

    try {
      const res = await adminClient.get(`/api/admin/dr/articles/${record.articleId}`);
      if (res.data.code === 200) {
        const detail = res.data.data;
        if (detail.content) {
          setPreviewContent(detail.content);
          setPreviewType(detail.contentType || "html");
        } else {
          setPreviewContent(`<p><b>摘要：</b>${record.summary || "暂无内容"}</p>`);
          setPreviewType("html");
        }
      } else {
        setPreviewContent(`<p><b>摘要：</b>${record.summary || "暂无内容"}</p>`);
        setPreviewType("html");
      }
    } catch {
      setPreviewContent(`<p><b>摘要：</b>${record.summary || "加载内容失败"}</p>`);
      setPreviewType("html");
    }
  };

  const openAiBeautify = () => {
    setAiInputContent(formContent);
    setAiOutputHtml("");
    setAiBeautifyOpen(true);
  };

  const handleAiBeautify = async () => {
    if (!aiInputContent.trim()) {
      message.warning("请先输入需要格式化的内容");
      return;
    }
    setAiBeautifying(true);
    try {
      const res = await adminClient.post("/api/admin/ai/beautify", { content: aiInputContent }, { timeout: 180_000 });
      if (res.data.code === 200) {
        setAiOutputHtml(res.data.data.html);
      } else {
        message.error(res.data.message || "格式化失败");
      }
    } catch {
      message.error("AI 服务暂不可用，请稍后重试");
    } finally {
      setAiBeautifying(false);
    }
  };

  const handleApplyAiResult = () => {
    if (!aiOutputHtml) {
      message.warning("暂无格式化结果");
      return;
    }
    setFormContent(aiOutputHtml);
    setFormContentType("html");
    setAiBeautifyOpen(false);
    message.success("已回填到正文编辑框");
  };

  const handleFormSpaceChange = async (spaceId: string) => {
    setFormSpaceId(spaceId);
    setFormChannelId(undefined);
    const chs = await fetchChannelsForSpace(spaceId);
    setFormChannels(chs);
  };

  const columns = [
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
      width: 200,
      ellipsis: true,
    },
    {
      title: "作者",
      dataIndex: "author",
      key: "author",
      width: 80,
    },
    {
      title: "空间",
      dataIndex: "spaceId",
      key: "spaceId",
      width: 120,
      render: (v: string) => spaceNameMap.get(v) || v,
    },
    {
      title: "频道",
      dataIndex: "channelId",
      key: "channelId",
      width: 100,
      render: (v: string) => channelNameMap.get(v) || v,
    },
    {
      title: "布局",
      dataIndex: "layoutType",
      key: "layoutType",
      width: 70,
    },
    {
      title: "阅读数",
      dataIndex: "readCount",
      key: "readCount",
      width: 70,
      align: "center" as const,
    },
    {
      title: "收藏数",
      dataIndex: "bookmarkCount",
      key: "bookmarkCount",
      width: 70,
      align: "center" as const,
    },
    {
      title: "发布时间",
      dataIndex: "publishedAt",
      key: "publishedAt",
      width: 170,
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      render: (_: unknown, record: ArticleRecord) => (
        <div style={{ display: "flex", gap: 12 }}>
          <span onClick={() => handlePreview(record)} style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            <EyeOutlined />
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

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#666" }}>空间：</span>
          <Select
            value={filterSpaceId}
            onChange={(v) => setFilterSpaceId(v)}
            allowClear
            placeholder="全部空间"
            style={{ width: 160 }}
            options={spaces.map((s) => ({ value: s.spaceId, label: s.name }))}
          />
          <span style={{ fontSize: 13, color: "#666" }}>频道：</span>
          <Select
            value={filterChannelId}
            onChange={(v) => setFilterChannelId(v)}
            allowClear
            placeholder="全部频道"
            style={{ width: 160 }}
            disabled={!filterSpaceId}
            options={channels.map((c) => ({ value: c.channelId, label: c.name }))}
          />
          <span style={{ fontSize: 13, color: "#999" }}>共 {total} 篇</span>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 4 }}>
          新建文章
        </Button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : (
        <Table
          dataSource={articles}
          columns={columns}
          rowKey="articleId"
          size="small"
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 篇`,
            size: "small",
          }}
        />
      )}

      <Drawer
        title={editing ? "编辑文章" : "新建文章"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={720}
        extra={
          <Button type="primary" onClick={handleSave} loading={saving} style={{ borderRadius: 4 }}>
            保存
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>标题 *</div>
            <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="文章标题" />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>空间 *</div>
              <Select
                value={formSpaceId}
                onChange={handleFormSpaceChange}
                placeholder="选择空间"
                style={{ width: "100%" }}
                options={spaces.map((s) => ({ value: s.spaceId, label: s.name }))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>频道 *</div>
              <Select
                value={formChannelId}
                onChange={setFormChannelId}
                placeholder="选择频道"
                style={{ width: "100%" }}
                disabled={!formSpaceId}
                options={formChannels.map((c) => ({ value: c.channelId, label: c.name }))}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>作者</div>
              <Input value={formAuthor} onChange={(e) => setFormAuthor(e.target.value)} placeholder="作者名称" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>布局类型</div>
              <Select
                value={formLayoutType}
                onChange={setFormLayoutType}
                style={{ width: "100%" }}
                options={[
                  { value: "default", label: "默认" },
                  { value: "card", label: "卡片" },
                  { value: "wide", label: "宽幅" },
                ]}
              />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>摘要</div>
            <Input.TextArea value={formSummary} onChange={(e) => setFormSummary(e.target.value)} placeholder="文章摘要" rows={2} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>精彩摘录（每行一条）</div>
            <Input.TextArea value={formHighlights} onChange={(e) => setFormHighlights(e.target.value)} placeholder="每行输入一条精彩摘录，如：&#10;人生如逆旅，我亦是行人&#10;不畏浮云遮望眼" rows={3} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>封面 URL</div>
            <Input value={formCoverUrl} onChange={(e) => setFormCoverUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 13, color: "#666", userSelect: "none" }} onDoubleClick={() => setShowContentTypeSwitch((v) => !v)}>正文内容</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button
                  size="small"
                  icon={<MobileOutlined />}
                  onClick={() => setMobilePreviewOpen(true)}
                  style={{ borderRadius: 4, color: "#111", borderColor: "#d9d9d9", background: "#fff" }}
                >
                  手机预览
                </Button>
                <Button
                  size="small"
                  icon={<ThunderboltOutlined />}
                  onClick={openAiBeautify}
                  style={{ borderRadius: 4, color: "#111", borderColor: "#d9d9d9", background: "#fff" }}
                >
                  AI 格式美化
                </Button>
                {showContentTypeSwitch && (
                  <Select
                    value={formContentType}
                    onChange={setFormContentType}
                    size="small"
                    options={[
                      { value: "html", label: "HTML" },
                      { value: "markdown", label: "Markdown" },
                    ]}
                  />
                )}
              </div>
            </div>
            <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, overflow: "hidden" }}>
              <Editor
                height="400px"
                language={formContentType === "markdown" ? "markdown" : "html"}
                value={formContent}
                onChange={(v) => setFormContent(v || "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: "'SF Mono', 'Fira Code', 'Menlo', monospace",
                  tabSize: 2,
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                  renderLineHighlight: "none",
                  overviewRulerBorder: false,
                  scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                  padding: { top: 8, bottom: 8 },
                  wordWrap: "on",
                }}
              />
            </div>
          </div>
        </div>
      </Drawer>

      <Modal
        title={previewTitle}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={800}
        styles={{ body: { padding: "20px 0" } }}
      >
        <div style={{ padding: "0 24px", fontSize: 15, lineHeight: 1.8, color: "#333", maxHeight: "70vh", overflowY: "auto" }}>
          {previewType === "markdown" ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {previewContent}
            </ReactMarkdown>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: previewContent }} />
          )}
        </div>
      </Modal>

      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ThunderboltOutlined style={{ color: "#111" }} />
            <span>AI 格式美化</span>
          </div>
        }
        open={aiBeautifyOpen}
        onCancel={() => setAiBeautifyOpen(false)}
        footer={null}
        width={960}
        styles={{ body: { padding: "16px 24px 24px" } }}
      >
        <div style={{ display: "flex", gap: 16, height: 680 }}>
          {/* 左侧输入区 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: "#666", fontWeight: 500 }}>输入内容</div>
            <Input.TextArea
              value={aiInputContent}
              onChange={(e) => setAiInputContent(e.target.value)}
              placeholder="粘贴需要格式化的原始文本内容..."
              style={{ flex: 1, resize: "none", fontSize: 13, lineHeight: 1.7, borderRadius: 6 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={aiBeautifying}
                onClick={handleAiBeautify}
                style={{ flex: 1, borderRadius: 6, background: "#111", borderColor: "#111", color: "#fff", height: 38 }}
              >
                {aiBeautifying ? "格式化中..." : "开始格式美化"}
              </Button>
              <Button
                onClick={handleApplyAiResult}
                disabled={!aiOutputHtml}
                style={{ flex: 1, borderRadius: 6, height: 38, borderColor: "#111", color: "#111", background: "#fff" }}
              >
                使用此结果
              </Button>
            </div>
          </div>

          {/* 分隔线 */}
          <div style={{ width: 1, background: "#f0f0f0", flexShrink: 0 }} />

          {/* 右侧预览区 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "#666", fontWeight: 500, alignSelf: "flex-start" }}>手机预览</div>
            <div
              style={{
                width: 320,
                height: 640,
                border: "2px solid #e0e0e0",
                borderRadius: 16,
                overflow: "hidden",
                background: "#fff",
                boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  height: "100%",
                  overflowY: "auto",
                  padding: "16px 14px",
                  fontSize: 14,
                  lineHeight: 1.8,
                  color: "#333",
                }}
              >
                {aiOutputHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: aiOutputHtml }} />
                ) : (
                  <div style={{ color: "#bbb", fontSize: 13, textAlign: "center", paddingTop: 80 }}>
                    格式化结果将在此预览
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <MobilePreviewModal
        open={mobilePreviewOpen}
        onClose={() => setMobilePreviewOpen(false)}
        title={formTitle || "手机预览"}
        content={formContent}
        contentType={formContentType}
      />
    </div>
  );
}
