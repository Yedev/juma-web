import { useState, useEffect, useCallback, useRef } from "react";
import { message, Button, Popconfirm, Upload, Image, Input, Tooltip } from "antd";
import { UploadOutlined, DeleteOutlined, CopyOutlined, PictureOutlined, LoadingOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { adminClient, BASE_URL } from "../api/client";

interface ImageFile {
  filename: string;
  url: string;
  size: number;
  createdAt: number;
}

const PAGE_SIZE = 50;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ImageHosting() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const markerRef = useRef<string | undefined>(undefined);

  const fetchImages = useCallback(async (append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      markerRef.current = undefined;
    }
    try {
      const res = await adminClient.get("/api/admin/upload/images", {
        params: { marker: append ? markerRef.current : undefined, page_size: PAGE_SIZE },
      });
      const { data, hasMore: more, nextMarker } = res.data as {
        data: ImageFile[];
        hasMore: boolean;
        nextMarker?: string;
      };
      setImages((prev) => (append ? [...prev, ...data] : data));
      setHasMore(more);
      markerRef.current = nextMarker;
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  const handleDelete = async (filename: string) => {
    await adminClient.delete(`/api/admin/upload/images`, { params: { filename } });
    message.success("已删除");
    fetchImages();
  };

  const copyUrl = (url: string) => {
    const full = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    navigator.clipboard.writeText(full).then(() => message.success("已复制"));
  };

  const uploadProps: UploadProps = {
    name: "file",
    action: `${BASE_URL}/api/admin/upload/image`,
    headers: { Authorization: `Bearer ${localStorage.getItem("juma_token") || ""}` },
    accept: "image/*",
    multiple: true,
    showUploadList: false,
    beforeUpload: () => { setUploading(true); return true; },
    onChange(info) {
      const stillUploading = info.fileList.some((f) => f.status === "uploading");
      setUploading(stillUploading);

      if (info.file.status === "done") {
        message.success(`${info.file.name} 上传成功`);
      } else if (info.file.status === "error") {
        // 优先取后端返回的失败原因，其次取请求层错误（如网络/超时）
        const reason =
          info.file.response?.message ||
          (info.file.error as Error | undefined)?.message ||
          "未知原因";
        message.error(`${info.file.name} 上传失败：${reason}`);
      }

      // 全部文件处理完毕后再刷新列表，避免多张图逐张刷新
      if (!stillUploading) {
        fetchImages();
      }
    },
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <span style={{ fontSize: 14, color: "#999" }}>共 {images.length} 张图片{hasMore ? "+" : ""}</span>
        <Upload {...uploadProps}>
          <Button icon={<UploadOutlined />} loading={uploading} type="primary">
            上传图片
          </Button>
        </Upload>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#ccc" }}>加载中...</div>
      ) : images.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#ccc" }}>
          <PictureOutlined style={{ fontSize: 40, display: "block", marginBottom: 12 }} />
          暂无图片
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
            {images.map((img) => {
              return (
                <div
                  key={img.filename}
                  style={{ border: "1px solid #f0f0f0", borderRadius: 6, overflow: "hidden", background: "#fafafa" }}
                >
                  <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f5", overflow: "hidden" }}>
                    <Image
                      src={img.url}
                      alt={img.filename}
                      style={{ maxHeight: 140, maxWidth: "100%", objectFit: "contain" }}
                      preview={{ src: img.url }}
                    />
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 11, color: "#999", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {img.filename.split("/").pop()}
                    </div>
                    <div style={{ fontSize: 11, color: "#bbb", marginBottom: 8 }}>{formatSize(img.size)}</div>
                    <Input
                      size="small"
                      value={img.url.startsWith("http") ? img.url : `${window.location.origin}${img.url}`}
                      readOnly
                      style={{ fontSize: 10, marginBottom: 8 }}
                      suffix={
                        <Tooltip title="复制链接">
                          <CopyOutlined style={{ cursor: "pointer", color: "#999" }} onClick={() => copyUrl(img.url)} />
                        </Tooltip>
                      }
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button size="small" icon={<CopyOutlined />} style={{ flex: 1, fontSize: 12 }} onClick={() => copyUrl(img.url)}>
                        复制
                      </Button>
                      <Popconfirm title="确认删除？" onConfirm={() => handleDelete(img.filename)} okText="删除" cancelText="取消">
                        <Button size="small" danger icon={<DeleteOutlined />} style={{ fontSize: 12 }} />
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {hasMore && (
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <Button onClick={() => fetchImages(true)} loading={loadingMore} icon={!loadingMore ? <LoadingOutlined /> : undefined}>
                加载更多
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
