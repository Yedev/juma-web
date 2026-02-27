import { useState } from "react";
import { Form, Input, Button, message } from "antd";
import { useNavigate } from "react-router-dom";
import { adminClient } from "../api/client";

export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await adminClient.post("/api/auth/login", values);
      if (res.data.code === 200) {
        localStorage.setItem("juma_token", res.data.data.token);
        localStorage.setItem("juma_username", res.data.data.username);
        message.success("登录成功");
        navigate("/tasks");
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      message.error(error.response?.data?.message || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "#f5f5f5",
      }}
    >
      <div
        style={{
          width: 360,
          background: "#fff",
          border: "1px solid #e8e8e8",
          borderRadius: 4,
          padding: "40px 32px 32px",
        }}
      >
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: "#333", marginBottom: 6 }}>
            JUMA
          </div>
          <div style={{ fontSize: 13, color: "#999" }}>
            应用后台管理系统
          </div>
        </div>

        <Form name="login" onFinish={onFinish}>
          <Form.Item name="username" rules={[{ required: true, message: "请输入账号" }]}>
            <Input
              placeholder="账号"
              style={{
                height: 40,
                borderRadius: 4,
                border: "1px solid #e0e0e0",
              }}
            />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password
              placeholder="密码"
              style={{
                height: 40,
                borderRadius: 4,
                border: "1px solid #e0e0e0",
              }}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{
                height: 40,
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 500,
                background: "#333",
                borderColor: "#333",
              }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
