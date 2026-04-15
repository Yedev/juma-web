import { useState, useEffect, useCallback } from "react";
import { message, Table, Spin, Button } from "antd";
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
        <span style={{ fontSize: 13, color: "#999" }}>共 {total} 位用户（只读，用户通过手机端注册）</span>
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
