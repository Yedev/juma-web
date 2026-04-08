import { useState } from "react";
import {
  UnorderedListOutlined,
  SettingOutlined,
  ApiOutlined,
  LogoutOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  ReadOutlined,
  TeamOutlined,
  FolderOutlined,
  StarOutlined,
  PictureOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Outlet, useNavigate, useLocation } from "react-router-dom";

type MenuItem = { key: string; icon: React.ReactNode; label: string } | { type: "divider"; label: string };

const menuItems: MenuItem[] = [
  { key: "/tasks", icon: <UnorderedListOutlined />, label: "任务管理" },
  { key: "/config", icon: <SettingOutlined />, label: "配置管理" },
  { key: "/media", icon: <PictureOutlined />, label: "图床" },
  { key: "/api-playground", icon: <ApiOutlined />, label: "API接口说明" },
  { type: "divider", label: "DeepRead" },
  { key: "/dr/spaces", icon: <AppstoreOutlined />, label: "空间管理" },
  { key: "/dr/channels", icon: <BranchesOutlined />, label: "频道管理" },
  { key: "/dr/collections", icon: <FolderOutlined />, label: "集合管理" },
  { key: "/dr/articles", icon: <ReadOutlined />, label: "文章管理" },
  { key: "/dr/daily-picks", icon: <StarOutlined />, label: "每日精选" },
  { key: "/dr/users", icon: <TeamOutlined />, label: "用户管理" },
  { key: "/dr/ai-config", icon: <RobotOutlined />, label: "AI 配置" },
  { key: "/dr/ai-quotas", icon: <RobotOutlined />, label: "AI 配额" },
];

const pageTitle: Record<string, string> = {
  "/tasks": "任务管理",
  "/config": "配置管理",
  "/media": "图床",
  "/api-playground": "API接口说明",
  "/dr/spaces": "空间管理",
  "/dr/channels": "频道管理",
  "/dr/collections": "集合管理",
  "/dr/articles": "文章管理",
  "/dr/daily-picks": "每日精选",
  "/dr/users": "用户管理",
  "/dr/ai-config": "AI 配置",
  "/dr/ai-quotas": "AI 配额管理",
};

export default function AdminLayout() {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const username = localStorage.getItem("juma_username") || "admin";

  const handleLogout = () => {
    localStorage.removeItem("juma_token");
    localStorage.removeItem("juma_username");
    navigate("/login");
  };

  const currentTitle = pageTitle[location.pathname] || "JUMA";

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f5f5f5" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 200,
          background: "#fff",
          borderRight: "1px solid #e8e8e8",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div
          style={{
            height: 52,
            display: "flex",
            alignItems: "center",
            paddingLeft: 20,
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: "#333", letterSpacing: 1 }}>
            JUMA
          </span>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "8px 0", overflow: "auto" }}>
          {menuItems.map((item, idx) => {
            if ("type" in item && item.type === "divider") {
              return (
                <div
                  key={`divider-${idx}`}
                  style={{
                    padding: "12px 16px 4px",
                    margin: "4px 8px 0",
                    fontSize: 11,
                    color: "#bbb",
                    fontWeight: 500,
                    letterSpacing: 1,
                    borderTop: "1px solid #f0f0f0",
                  }}
                >
                  {item.label}
                </div>
              );
            }
            const navItem = item as { key: string; icon: React.ReactNode; label: string };
            const isActive = location.pathname === navItem.key;
            const isHovered = hoveredKey === navItem.key;
            return (
              <div
                key={navItem.key}
                onClick={() => navigate(navItem.key)}
                onMouseEnter={() => setHoveredKey(navItem.key)}
                onMouseLeave={() => setHoveredKey(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "0 16px",
                  height: 40,
                  margin: "2px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 14,
                  color: isActive ? "#333" : "#666",
                  fontWeight: isActive ? 500 : 400,
                  background: isActive ? "#f0f0f0" : isHovered ? "#f7f7f7" : "transparent",
                  transition: "all 0.15s ease",
                }}
              >
                <span style={{ fontSize: 15, opacity: 0.7 }}>{navItem.icon}</span>
                <span>{navItem.label}</span>
              </div>
            );
          })}
        </nav>

        {/* User & logout at bottom */}
        <div
          style={{
            borderTop: "1px solid #f0f0f0",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 13, color: "#999" }}>{username}</span>
          <span
            onClick={handleLogout}
            style={{ fontSize: 13, color: "#bbb", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#666")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#bbb")}
          >
            <LogoutOutlined style={{ fontSize: 12 }} />
            退出
          </span>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top bar */}
        <header
          style={{
            height: 52,
            background: "#fff",
            borderBottom: "1px solid #e8e8e8",
            display: "flex",
            alignItems: "center",
            padding: "0 24px",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 500, color: "#333" }}>
            {currentTitle}
          </span>
        </header>

        {/* Content */}
        <main
          style={{
            flex: 1,
            overflow: "auto",
            padding: 24,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 4,
              border: "1px solid #e8e8e8",
              padding: 24,
              minHeight: "calc(100vh - 124px)",
            }}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
