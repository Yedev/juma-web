import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import Login from "./pages/Login";
import AdminLayout from "./layouts/AdminLayout";
import TaskManagement from "./pages/TaskManagement";
import ConfigManagement from "./pages/ConfigManagement";
import ApiPlayground from "./pages/ApiPlayground";
import DrSpaceManagement from "./pages/DrSpaceManagement";
import DrChannelManagement from "./pages/DrChannelManagement";
import DrArticleManagement from "./pages/DrArticleManagement";
import DrUserManagement from "./pages/DrUserManagement";
import DrCollectionManagement from "./pages/DrCollectionManagement";
import DrDailyPicksManagement from "./pages/DrDailyPicksManagement";
import DrAiConfig from "./pages/DrAiConfig";
import ImageHosting from "./pages/ImageHosting";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("juma_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#333",
          borderRadius: 4,
          colorBgContainer: "#fff",
          colorBorder: "#e8e8e8",
          colorText: "#333",
          colorTextSecondary: "#999",
          fontSize: 14,
        },
        components: {
          Menu: {
            itemBg: "transparent",
            itemSelectedBg: "#f0f0f0",
            itemSelectedColor: "#333",
            itemColor: "#666",
            itemHoverColor: "#333",
            itemHoverBg: "#f5f5f5",
          },
          Table: {
            headerBg: "#fafafa",
            headerColor: "#666",
            rowHoverBg: "#f9f9f9",
            borderColor: "#f0f0f0",
          },
          Button: {
            defaultBorderColor: "#e0e0e0",
            primaryColor: "#fff",
          },
        },
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AdminLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/tasks" replace />} />
            <Route path="tasks" element={<TaskManagement />} />
            <Route path="config" element={<ConfigManagement />} />
            <Route path="api-playground" element={<ApiPlayground />} />
            <Route path="dr/spaces" element={<DrSpaceManagement />} />
            <Route path="dr/channels" element={<DrChannelManagement />} />
            <Route path="dr/collections" element={<DrCollectionManagement />} />
            <Route path="dr/articles" element={<DrArticleManagement />} />
            <Route path="dr/users" element={<DrUserManagement />} />
            <Route path="dr/daily-picks" element={<DrDailyPicksManagement />} />
            <Route path="dr/ai-config" element={<DrAiConfig />} />
            <Route path="media" element={<ImageHosting />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
