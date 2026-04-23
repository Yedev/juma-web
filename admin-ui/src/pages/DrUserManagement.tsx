import { useState, useEffect, useCallback } from "react";
import { message, Table, Spin, Button, Modal } from "antd";
import { ExclamationCircleFilled } from "@ant-design/icons";
import { adminClient } from "../api/client";

interface UserRecord {
  id: number;
  phone: string;
  nickname: string;
  avatar: string;
  spaceCount: number;
  highlightCount: number;
  createdAt: string;
}

interface UserSpace {
  spaceId: string;
  spaceName: string;
  role: string;
  joinedAt: string;
}

interface SyncBackup {
  data: string;
  createdAt: string;
  updatedAt: string;
}

export default function DrUserManagement() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expandedSpaces, setExpandedSpaces] = useState<Record<number, UserSpace[]>>({});
  const [syncBackups, setSyncBackups] = useState<Record<number, SyncBackup | null>>({});
  const [expandLoading, setExpandLoading] = useState<Record<number, boolean>>({});

  const fetchUsers = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await adminClient.get("/api/admin/dr/users", {
        params: { page: p, page_size: 20 },
      });
      if (res.data.code === 200) {
        setUsers(res.data.data.list);
        setTotal(res.data.data.total);
      }
    } catch {
      message.error("加载用户列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(page);
  }, [page, fetchUsers]);

  const handleDelete = (record: UserRecord) => {
    Modal.confirm({
      title: "确认删除该用户？",
      icon: <ExclamationCircleFilled style={{ color: "#ff4d4f" }} />,
      width: 480,
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 8 }}>
            将永久删除用户 <strong>{record.nickname || "（无昵称）"}</strong>（手机号 <span style={{ fontFamily: "monospace" }}>{record.phone}</span>）及其全部数据：
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, color: "#666" }}>
            <li>空间成员关系（{record.spaceCount} 个）</li>
            <li>批注（{record.highlightCount} 条）</li>
            <li>个人收藏夹及收藏文章</li>
            <li>AI 配额与使用记录</li>
            <li>同步备份数据</li>
            <li>阅读统计</li>
          </ul>
          <div style={{ marginTop: 10, color: "#ff4d4f", fontWeight: 500 }}>
            此操作不可恢复，请谨慎操作！
          </div>
        </div>
      ),
      onOk: async () => {
        try {
          const res = await adminClient.delete(`/api/admin/dr/users/${record.id}`);
          if (res.data.code === 200) {
            message.success("用户已删除");
            setExpandedSpaces((prev) => {
              const next = { ...prev };
              delete next[record.id];
              return next;
            });
            setSyncBackups((prev) => {
              const next = { ...prev };
              delete next[record.id];
              return next;
            });
            fetchUsers(page);
          } else {
            message.error(res.data.message || "删除失败");
          }
        } catch {
          message.error("删除用户失败");
        }
      },
    });
  };

  const handleExpand = async (expanded: boolean, record: UserRecord) => {
    if (!expanded) return;
    if (expandedSpaces[record.id] && syncBackups[record.id] !== undefined) return; // Already loaded

    setExpandLoading((prev) => ({ ...prev, [record.id]: true }));
    try {
      const [userRes, backupRes] = await Promise.all([
        expandedSpaces[record.id] ? Promise.resolve(null) : adminClient.get(`/api/admin/dr/users/${record.id}`),
        syncBackups[record.id] !== undefined ? Promise.resolve(null) : adminClient.get(`/api/admin/dr/users/${record.id}/sync-backup`),
      ]);
      if (userRes && userRes.data.code === 200) {
        setExpandedSpaces((prev) => ({ ...prev, [record.id]: userRes.data.data.spaces }));
      }
      if (backupRes && backupRes.data.code === 200) {
        setSyncBackups((prev) => ({ ...prev, [record.id]: backupRes.data.data }));
      }
    } catch {
      message.error("加载用户详情失败");
    } finally {
      setExpandLoading((prev) => ({ ...prev, [record.id]: false }));
    }
  };

  const columns = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 60,
    },
    {
      title: "手机号",
      dataIndex: "phone",
      key: "phone",
      width: 130,
      render: (v: string) => <span style={{ fontFamily: "monospace" }}>{v}</span>,
    },
    {
      title: "昵称",
      dataIndex: "nickname",
      key: "nickname",
      width: 120,
    },
    {
      title: "头像",
      dataIndex: "avatar",
      key: "avatar",
      width: 60,
      render: (v: string) =>
        v ? (
          <img
            src={v}
            alt="avatar"
            style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ color: "#ccc", fontSize: 12 }}>无</span>
        ),
    },
    {
      title: "加入空间数",
      dataIndex: "spaceCount",
      key: "spaceCount",
      width: 100,
      align: "center" as const,
    },
    {
      title: "批注数",
      dataIndex: "highlightCount",
      key: "highlightCount",
      width: 80,
      align: "center" as const,
    },
    {
      title: "注册时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      width: 80,
      fixed: "right" as const,
      render: (_: unknown, record: UserRecord) => (
        <Button type="link" size="small" danger onClick={() => handleDelete(record)}>
          删除
        </Button>
      ),
    },
  ];

  const spaceColumns = [
    { title: "空间名称", dataIndex: "spaceName", key: "spaceName", width: 160 },
    { title: "Space ID", dataIndex: "spaceId", key: "spaceId", width: 140, render: (v: string) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{v}</span> },
    { title: "角色", dataIndex: "role", key: "role", width: 80 },
    { title: "加入时间", dataIndex: "joinedAt", key: "joinedAt", render: (v: string) => new Date(v).toLocaleString("zh-CN") },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "#999" }}>共 {total} 位用户（用户通过手机端注册，管理后台可删除）</span>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : (
        <Table
          dataSource={users}
          columns={columns}
          rowKey="id"
          size="small"
          expandable={{
            onExpand: handleExpand,
            expandedRowRender: (record: UserRecord) => {
              if (expandLoading[record.id]) {
                return (
                  <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
                    <Spin size="small" />
                  </div>
                );
              }
              const spaces = expandedSpaces[record.id];
              const backup = syncBackups[record.id];
              return (
                <div style={{ margin: "0 16px" }}>
                  <div style={{ marginBottom: 12 }}>
                    <strong>加入空间</strong>
                    {(!spaces || spaces.length === 0) ? (
                      <div style={{ color: "#999", fontSize: 12, padding: 8 }}>该用户未加入任何空间</div>
                    ) : (
                      <Table
                        dataSource={spaces}
                        columns={spaceColumns}
                        rowKey="spaceId"
                        pagination={false}
                        size="small"
                      />
                    )}
                  </div>
                  <div>
                    <strong>同步数据</strong>
                    {!backup ? (
                      <div style={{ color: "#999", fontSize: 12, padding: 8 }}>暂无同步数据</div>
                    ) : (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                          最后更新：{new Date(backup.updatedAt).toLocaleString("zh-CN")}
                          &nbsp;|&nbsp;数据大小：{new Blob([backup.data]).size} bytes
                          <Button
                            type="link"
                            size="small"
                            style={{ padding: 0, marginLeft: 8 }}
                            onClick={() => {
                              navigator.clipboard.writeText(backup.data);
                              message.success("已复制到剪贴板");
                            }}
                          >
                            复制
                          </Button>
                        </div>
                        <pre style={{
                          background: "#f5f5f5",
                          padding: 8,
                          borderRadius: 4,
                          fontSize: 11,
                          maxHeight: 200,
                          overflow: "auto",
                          wordBreak: "break-all",
                          whiteSpace: "pre-wrap",
                        }}>
                          {(() => { try { return JSON.stringify(JSON.parse(backup.data), null, 2); } catch { return backup.data; } })()}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            },
          }}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 位`,
            size: "small",
          }}
        />
      )}
    </div>
  );
}
