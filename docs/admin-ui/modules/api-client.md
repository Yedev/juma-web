# admin-ui API 客户端详解

本文档详细说明 `src/api/client.ts` 和 `src/utils/sign.ts` 的实现原理、使用方式和错误处理模式。

---

## src/api/client.ts 详解

### 文件职责

`client.ts` 是 `admin-ui` 所有后台管理接口请求的统一入口，负责：
1. 创建配置好的 Axios 实例（`adminClient`）
2. 通过请求拦截器自动注入 Bearer Token
3. 通过响应拦截器处理全局 401 鉴权失败，自动清除 Token 并跳转到登录页

### Axios 实例配置

```ts
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const adminClient = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
});
```

**关键配置说明**：

| 配置项 | 值 | 说明 |
|---|---|---|
| `baseURL` | `VITE_API_BASE_URL` 或空字符串 | 空字符串配合 Vite proxy 使用相对路径，生产环境可配置绝对 URL |
| `timeout` | `10000`（10秒） | 请求超时时间，超时后自动抛出 `ECONNABORTED` 错误 |

`BASE_URL` 常量同时被导出，供 `ApiPlayground.tsx` 使用（测试面板直接构建完整请求 URL 时需要）。

---

### 请求拦截器 — 自动注入 Bearer Token

```ts
adminClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("juma_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

**工作流程**：
1. 每次发起请求之前，拦截器从 `localStorage` 读取 `juma_token`
2. 若 Token 存在，则设置请求头 `Authorization: Bearer <token>`
3. 若 Token 不存在（未登录状态），则不添加该请求头，请求照常发出（但会被后端 401 拒绝）
4. 返回修改后的 `config` 对象，让请求继续

**设计特点**：
- 每次请求动态读取 Token，无需在登录时重新创建 Axios 实例
- Token 更新（如刷新 Token）后立即生效，无缓存问题
- 不修改全局默认 headers，避免污染其他 Axios 实例

---

### 响应拦截器 — 401 处理与全局错误

```ts
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
```

**工作流程**：

成功响应（2xx）：直接透传响应对象，不做额外处理。

失败响应：
1. 检测 HTTP 状态码是否为 **401**
2. 若是 401，说明 Token 已过期或无效：
   - 清除 `localStorage` 中的 `juma_token` 和 `juma_username`
   - 使用 `window.location.href = "/login"` 进行硬跳转（而非 `navigate()`），确保 React 状态完全重置
3. 无论是否 401，都将 error 通过 `Promise.reject` 继续向上抛出，由各页面组件的 `catch` 块处理

**为何使用 `window.location.href` 而非 `navigate()`**：
- `window.location.href` 是直接导航，会完全刷新页面，清除所有 React 状态和内存中的数据
- 在 Axios 拦截器中无法直接访问 React Router 的 `navigate` 函数（拦截器在 React 组件树之外）
- 强制刷新能确保用户在重新登录后获得干净的应用状态

---

### 导出内容

```ts
export { adminClient, BASE_URL };
```

| 导出名 | 类型 | 用途 |
|---|---|---|
| `adminClient` | Axios 实例 | 所有页面导入此实例进行 API 调用 |
| `BASE_URL` | string | 供 `ApiPlayground` 页面构建完整 URL |

---

## src/utils/sign.ts 详解

### 文件职责

`sign.ts` 提供用于公开接口（`/api/v1/app/`）的请求签名生成功能。这些接口不使用 Bearer Token，而是使用时间戳 + MD5 签名的方式验证请求合法性，防止接口被未授权调用。

### generateSign() 函数

```ts
import CryptoJS from "crypto-js";

const APP_SECRET = "juma2026_secret";

export function generateSign(): { timestamp: string; sign: string } {
  const timestamp = Date.now().toString();
  const sign = CryptoJS.MD5(APP_SECRET + timestamp).toString();
  return { timestamp, sign };
}
```

**返回值**：
| 字段 | 类型 | 示例值 | 说明 |
|---|---|---|---|
| `timestamp` | string | `"1742521234567"` | 当前毫秒级时间戳（13位） |
| `sign` | string | `"a1b2c3d4..."` | 32位小写 MD5 哈希字符串 |

**签名算法**：
```
sign = MD5( APP_SECRET + timestamp )
     = MD5( "juma2026_secret" + "1742521234567" )
```

`CryptoJS.MD5(str).toString()` 默认输出 32 位小写十六进制字符串，与标准 MD5 格式一致。

### 与后端验证的对应关系

后端接收到请求后验证签名的逻辑：
1. 从请求头读取 `x-timestamp`（毫秒时间戳）和 `x-sign`（MD5 签名）
2. 用相同算法计算 `expectedSign = MD5(APP_SECRET + x-timestamp)`
3. 比较 `x-sign === expectedSign`，不一致则返回 401
4. 验证时间戳是否在允许的有效窗口内（通常 ±5 分钟），防止重放攻击

前端调用示例（在 `ApiPlayground.tsx` 中）：
```ts
import { generateSign } from "../utils/sign";

const { timestamp, sign } = generateSign();

await axios.get(`${BASE_URL}/api/v1/app/config`, {
  params: { key: "global_json" },
  headers: {
    "x-timestamp": timestamp,
    "x-sign": sign,
  },
});
```

### Shell 等效实现

`ApiPlayground.tsx` 内置的 curl 示例使用 shell 版本的相同算法：
```bash
APP_SECRET="juma2026_secret"
TS=$(date +%s%3N)    # 13位毫秒时间戳
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')
```

注意：`md5sum` 命令在 macOS 上需替换为 `md5 -r` 或 `openssl md5`。

---

## 如何在新页面中使用 api client

### 基本用法

在新页面文件中导入 `adminClient`，然后直接调用 Axios 方法：

```ts
import { adminClient } from "../api/client";

// GET 请求
const res = await adminClient.get("/api/admin/some-resource");
if (res.data.code === 200) {
  setData(res.data.data);
}

// POST 请求
const res = await adminClient.post("/api/admin/some-resource", {
  name: "value",
});

// PUT 请求
const res = await adminClient.put(`/api/admin/some-resource/${id}`, {
  field: "new-value",
});

// DELETE 请求
const res = await adminClient.delete(`/api/admin/some-resource/${id}`);
```

### 统一的响应结构

所有后端接口遵循统一的响应格式：
```json
{
  "code": 200,
  "data": { ... },
  "message": "success"
}
```

**约定**：
- `code === 200` 表示成功，`data` 字段包含实际数据
- `code !== 200` 表示业务错误，`message` 字段包含错误描述
- HTTP 层面的错误（4xx/5xx）由 `catch` 块捕获，`error.response.data.message` 通常包含后端错误信息

### 带查询参数的 GET 请求

```ts
// 使用 params 对象（Axios 自动序列化为 ?key=value 格式）
const res = await adminClient.get("/api/admin/dr/articles", {
  params: {
    space_id: selectedSpaceId,
    channel_id: selectedChannelId,
    page: currentPage,
    page_size: 20,
  },
});
```

值为 `undefined` 的参数 Axios 会自动忽略，适合可选筛选参数。

### 路径参数编码

当路径中包含可能有特殊字符的动态参数时（如配置键名），务必使用 `encodeURIComponent`：

```ts
// 正确
await adminClient.get(`/api/admin/config/${encodeURIComponent(key)}`);

// 错误（键名含 . / 等字符时会导致路径解析错误）
await adminClient.get(`/api/admin/config/${key}`);
```

### 标准 Loading + 错误处理模式

项目中各页面采用统一的异步操作模式：

```ts
const [loading, setLoading] = useState(false);

const fetchData = useCallback(async () => {
  setLoading(true);
  try {
    const res = await adminClient.get("/api/admin/some-resource");
    if (res.data.code === 200) {
      setData(res.data.data);
    }
  } catch (err: unknown) {
    const error = err as { response?: { data?: { message?: string } } };
    message.error(error.response?.data?.message || "加载失败");
  } finally {
    setLoading(false);  // 无论成功或失败，始终关闭 loading
  }
}, []);

useEffect(() => {
  fetchData();
}, [fetchData]);
```

**关键点**：
- `setLoading(true)` 在请求前设置，`finally` 块中始终重置，避免 loading 状态卡住
- 使用 `useCallback` 包裹 fetch 函数，以便安全地放入 `useEffect` 的依赖数组
- `catch` 块中优先显示后端返回的 `message`，其次显示兜底文案

---

## 常见错误处理模式

### 模式一：操作成功/失败提示

```ts
try {
  const res = await adminClient.post("/api/admin/resource", payload);
  if (res.data.code === 200) {
    message.success("创建成功");
    fetchData();  // 刷新列表
    setModalOpen(false);  // 关闭弹窗
  }
} catch (err: unknown) {
  const error = err as { response?: { data?: { message?: string } } };
  message.error(error.response?.data?.message || "创建失败");
}
```

### 模式二：删除前二次确认

```tsx
// 使用 Popconfirm（行内确认，轻量）
<Popconfirm
  title="确认删除？"
  onConfirm={() => handleDelete(record.id)}
  okText="删除"
  cancelText="取消"
  okButtonProps={{ danger: true }}
>
  <DeleteOutlined style={{ cursor: "pointer", color: "#ccc" }} />
</Popconfirm>

// 使用 Modal.confirm（需要展示详细信息时）
Modal.confirm({
  title: "确认删除",
  content: `确定要删除 "${name}" 吗？此操作不可恢复。`,
  okText: "删除",
  cancelText: "取消",
  okButtonProps: { danger: true },
  onOk: async () => {
    await adminClient.delete(`/api/admin/resource/${id}`);
    message.success("已删除");
    fetchData();
  },
});
```

### 模式三：保存前校验 JSON

```ts
const handleSave = async () => {
  // 先校验 JSON 格式
  try {
    JSON.parse(jsonValue);
  } catch {
    message.error("JSON 格式不合法，请修正后再保存");
    return;  // 阻止提交
  }

  // 校验通过后发送请求
  setSaving(true);
  try {
    await adminClient.put("/api/admin/config/key", { value: jsonValue });
    message.success("保存成功");
  } catch {
    message.error("保存失败");
  } finally {
    setSaving(false);
  }
};
```

### 模式四：网络错误 vs 业务错误区分

```ts
try {
  const res = await adminClient.get("/api/admin/resource");
  // Axios 只在 2xx 时走此分支
  if (res.data.code !== 200) {
    // 后端业务错误（HTTP 200 但 code 非 200）
    message.error(res.data.message || "操作失败");
    return;
  }
  setData(res.data.data);
} catch (err: unknown) {
  // 网络错误或 HTTP 4xx/5xx
  const error = err as {
    response?: { data?: { message?: string }; status?: number };
    code?: string;
  };

  if (error.code === "ECONNABORTED") {
    message.error("请求超时，请检查网络连接");
  } else if (error.response?.status === 403) {
    message.error("权限不足");
  } else {
    message.error(error.response?.data?.message || "请求失败");
  }
}
```

### 模式五：并发请求（页面初始化时）

部分页面（如 DrArticleManagement）需要同时加载多个下拉选项的数据，使用 `Promise.all` 并发：

```ts
useEffect(() => {
  const init = async () => {
    try {
      const [spacesRes, channelsRes] = await Promise.all([
        adminClient.get("/api/admin/dr/spaces"),
        adminClient.get("/api/admin/dr/channels"),
      ]);
      if (spacesRes.data.code === 200) setSpaces(spacesRes.data.data);
      if (channelsRes.data.code === 200) setChannels(channelsRes.data.data);
    } catch {
      message.error("初始化数据加载失败");
    }
  };
  init();
}, []);
```

---

## 注意事项

1. **不要直接使用 `axios`** 进行需要鉴权的管理接口调用，必须使用 `adminClient`，否则请求头中不会有 Bearer Token
2. **公开接口**（`/api/v1/app/`）不使用 `adminClient`，而是直接 `import axios from "axios"`，并手动添加 `x-timestamp` 和 `x-sign` 请求头
3. **超时设置**：默认 10 秒超时。若某个操作耗时较长（如生成报告），需在调用时覆盖 timeout：
   ```ts
   await adminClient.post("/api/admin/long-task", payload, { timeout: 60000 });
   ```
4. **请求取消**：当前版本未实现请求取消（AbortController），快速切换页面时可能出现已卸载组件更新 state 的警告，属于已知限制
