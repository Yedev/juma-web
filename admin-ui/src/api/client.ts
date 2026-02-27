import axios from "axios";

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
    if (error.response?.status === 401) {
      localStorage.removeItem("juma_token");
      localStorage.removeItem("juma_username");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export { adminClient, BASE_URL };
