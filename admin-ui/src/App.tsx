import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import Login from "./pages/Login";
import AdminLayout from "./layouts/AdminLayout";
import TaskManagement from "./pages/TaskManagement";
import ConfigManagement from "./pages/ConfigManagement";
import ApiPlayground from "./pages/ApiPlayground";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("juma_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <ConfigProvider locale={zhCN}>
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
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
