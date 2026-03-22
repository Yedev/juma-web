import axios from "axios";
import { message } from "antd";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const adminClient = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
});

adminClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("juma_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

adminClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const msg = error.response?.data?.message || error.message || "请求失败";

    if (status === 401) {
      localStorage.removeItem("juma_token");
      localStorage.removeItem("juma_username");
      message.error("登录已过期，请重新登录");
    } else if (status) {
      message.error(`请求失败 (${status}): ${msg}`);
    } else {
      message.error(`网络错误: ${msg}`);
    }
    return Promise.reject(error);
  }
);

export { adminClient, BASE_URL };
