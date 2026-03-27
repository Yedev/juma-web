# DeepRead API 测试用例文档

> 版本: 1.0
> 更新时间: 2026-03-25
> 覆盖范围: 客户端 API + 管理后台 API

---

## 一、测试环境准备

### 1.1 基础配置

| 项目 | 值 |
|------|------|
| 基础 URL | `http://localhost:3000/api/v1/dr` |
| 管理后台 URL | `http://localhost:3000/api/admin` |
| 认证头 | `Authorization: Bearer <token>` |
| 签名头 | `x-timestamp`, `x-sign` |

### 1.2 测试数据

```sql
-- 测试用户
INSERT INTO dr_users (id, phone, nickname) VALUES (1, '13800138000', '测试用户');

-- 测试空间
INSERT INTO dr_spaces (space_id, name, invite_code) VALUES ('S1000001', '测试空间', 'TEST2026');

-- 测试频道
INSERT INTO dr_channels (channel_id, space_id, name) VALUES ('C1000001', 'S1000001', '科技前沿');

-- 测试文章
INSERT INTO dr_articles (article_id, space_id, channel_id, title, content) VALUES
('A1000001', 'S1000001', 'C1000001', '测试文章1', '<p>这是测试内容</p>'),
('A1000002', 'S1000001', 'C1000001', '测试文章2', '<p>这是测试内容2</p>');

-- 空间成员
INSERT INTO dr_space_members (space_id, user_id, role) VALUES ('S1000001', 1, 'member');
```

---

## 二、认证模块

### TC-AUTH-001: 发送短信验证码

**接口**: `POST /sms/send`

| 测试场景 | 请求体 | 预期状态 | 预期响应 |
|----------|--------|----------|----------|
| 正常发送 | `{"phone": "13800138000"}` | 200 | `{"code": 200, "message": "验证码已发送"}` |
| 空手机号 | `{}` | 400 | `{"code": 400, "message": "手机号不能为空"}` |
| 格式错误 | `{"phone": "123"}` | 400 | `{"code": 400, "message": "手机号格式错误"}` |

### TC-AUTH-002: 验证码登录

**接口**: `POST /login`

| 测试场景 | 请求体 | 预期状态 | 预期响应字段 |
|----------|--------|----------|--------------|
| 正常登录（已注册） | `{"phone": "13800138000", "code": "888888"}` | 200 | `token`, `user.id`, `user.phone` |
| 正常登录（新用户） | `{"phone": "13900139000", "code": "888888"}` | 200 | 自动创建用户 |
| 验证码错误 | `{"phone": "13800138000", "code": "000000"}` | 400 | `{"code": 400, "message": "验证码错误"}` |
| 验证码过期 | 使用过期验证码 | 400 | `{"code": 400, "message": "验证码已过期"}` |
| 空参数 | `{}` | 400 | 参数校验失败 |

---

## 三、空间模块

### TC-SPACE-001: 加入空间

**接口**: `POST /space/join`

| 测试场景 | 请求体 | 预期状态 | 预期响应 |
|----------|--------|----------|----------|
| 正常加入 | `{"invite_code": "TEST2026"}` | 200 | `spaceId`, `name` |
| 重复加入 | `{"invite_code": "TEST2026"}` | 200 | `{"message": "您已是该空间成员"}` |
| 无效邀请码 | `{"invite_code": "INVALID"}` | 404 | `{"code": 404, "message": "邀请码无效"}` |
| 空邀请码 | `{}` | 400 | 参数校验失败 |

### TC-SPACE-002: 获取空间首页

**接口**: `GET /spaces/:spaceId/homepage`

| 测试场景 | 路径参数 | 预期状态 | 验证点 |
|----------|----------|----------|--------|
| 正常获取 | spaceId=S1000001 | 200 | 返回模块列表，包含资源详情 |
| 非成员访问 | spaceId=OTHER | 403 | `{"message": "您不是该空间的成员"}` |
| 空间不存在 | spaceId=INVALID | 403 | 非成员错误 |
| 空首页 | 新空间无模块 | 200 | `{"data": []}` |

---

## 四、文章模块

### TC-ARTICLE-001: 获取文章列表

**接口**: `GET /articles`

| 测试场景 | 查询参数 | 预期状态 | 验证点 |
|----------|----------|----------|--------|
| 基础查询 | `space_id=S1000001` | 200 | 返回 `list`, `total`, `page`, `pageSize` |
| 分页查询 | `space_id=S1000001&page=1&page_size=10` | 200 | 正确分页 |
| 频道筛选 | `space_id=S1000001&channel_id=C1000001` | 200 | 仅返回该频道文章 |
| 缺少space_id | 无 | 400 | `{"message": "space_id 不能为空"}` |
| 无文章空间 | `space_id=EMPTY_SPACE` | 200 | `{"list": [], "total": 0}` |

### TC-ARTICLE-002: 获取文章详情

**接口**: `GET /articles/:articleId`

| 测试场景 | 路径参数 | 预期状态 | 验证点 |
|----------|----------|----------|--------|
| 正常获取 | articleId=A1000001 | 200 | 返回完整内容，readCount+1 |
| 文章不存在 | articleId=INVALID | 404 | `{"message": "文章不存在"}` |
| 包含用户状态 | 已登录用户 | 200 | 包含 `bookmarked`, `readProgress` |

### TC-ARTICLE-003: 收藏/取消收藏

**接口**: `PUT /articles/:articleId/bookmark`

| 测试场景 | 请求体 | 预期状态 | 预期响应 |
|----------|--------|----------|----------|
| 收藏 | `{"bookmarked": true}` | 200 | `{"message": "已收藏"}` |
| 取消收藏 | `{"bookmarked": false}` | 200 | `{"message": "已取消收藏"}` |
| 重复收藏 | `{"bookmarked": true}` | 200 | 幂等，无报错 |
| 文章不存在 | articleId=INVALID | 404 | `{"message": "文章不存在"}` |

### TC-ARTICLE-004: 标记已读

**接口**: `PUT /articles/:articleId/read`

| 测试场景 | 请求体 | 预期状态 | 验证点 |
|----------|--------|----------|--------|
| 标记已读 | `{}` | 200 | progress=100 |
| 更新进度 | `{"progress": 75}` | 200 | progress=75 |
| 边界值-0 | `{"progress": 0}` | 200 | progress=0 |
| 边界值-100 | `{"progress": 100}` | 200 | progress=100 |
| 超出范围 | `{"progress": 150}` | 200 | 建议限制在0-100 |
| 负数 | `{"progress": -10}` | 200 | 建议限制 |

---

## 五、批注模块

### TC-HIGHLIGHT-001: 创建批注

**接口**: `POST /highlights`

| 测试场景 | 请求体 | 预期状态 | 验证点 |
|----------|--------|----------|--------|
| 完整参数 | 见下方 | 200 | 返回 `highlightId` |
| 最简参数 | `{"article_id": "A1000001", "text": "高亮文字"}` | 200 | 使用默认颜色 |
| 缺少article_id | `{"text": "高亮文字"}` | 400 | `{"message": "article_id 不能为空"}` |
| 缺少text | `{"article_id": "A1000001"}` | 400 | `{"message": "text 不能为空"}` |
| 文章不存在 | `{"article_id": "INVALID", "text": "test"}` | 404 | 文章不存在 |

**完整请求体示例：**
```json
{
  "article_id": "A1000001",
  "text": "这是高亮的文字内容",
  "color": "#FFEB3B",
  "position_data": {"paragraph": 1, "offset": 10, "length": 20},
  "note": "这是批注笔记"
}
```

### TC-HIGHLIGHT-002: 更新批注

**接口**: `PUT /highlights/:highlightId`

| 测试场景 | 请求体 | 预期状态 | 验证点 |
|----------|--------|----------|--------|
| 更新颜色 | `{"color": "#FF5722"}` | 200 | 颜色已更新 |
| 更新笔记 | `{"note": "新笔记"}` | 200 | 笔记已更新 |
| 同时更新 | `{"color": "#FF5722", "note": "新笔记"}` | 200 | 两者都更新 |
| 批注不存在 | highlightId=INVALID | 404 | `{"message": "批注不存在"}` |
| 他人批注 | 非创建者 | 403 | `{"message": "无权修改他人的批注"}` |

### TC-HIGHLIGHT-003: 删除批注

**接口**: `DELETE /highlights/:highlightId`

| 测试场景 | 路径参数 | 预期状态 | 预期响应 |
|----------|----------|----------|----------|
| 正常删除 | 存在的highlightId | 200 | `{"message": "批注已删除"}` |
| 重复删除 | 已删除的ID | 404 | `{"message": "批注不存在"}` |
| 他人批注 | 非创建者 | 403 | `{"message": "无权删除他人的批注"}` |

### TC-HIGHLIGHT-004: 获取批注列表

**接口**: `GET /highlights?article_id=xxx`

| 测试场景 | 查询参数 | 预期状态 | 验证点 |
|----------|----------|----------|--------|
| 正常获取 | `article_id=A1000001` | 200 | 返回批注数组 |
| 缺少参数 | 无 | 400 | `{"message": "article_id 不能为空"}` |
| 无批注文章 | `article_id=NO_HIGHLIGHTS` | 200 | `{"data": []}` |

---

## 六、个人合集模块

### TC-COLLECTION-001: 创建合集

**接口**: `POST /collections`

| 测试场景 | 请求体 | 预期状态 | 验证点 |
|----------|--------|----------|--------|
| 正常创建 | `{"name": "我的合集"}` | 200 | 返回 `collectionId` |
| 空名称 | `{"name": ""}` | 400 | `{"message": "合集名称不能为空"}` |
| 缺少名称 | `{}` | 400 | 名称不能为空 |
| 仅空格 | `{"name": "   "}` | 400 | trim后为空 |

### TC-COLLECTION-002: 获取合集列表

**接口**: `GET /collections`

| 测试场景 | 预期状态 | 验证点 |
|----------|----------|--------|
| 有合集 | 200 | 返回列表，含 `articleCount` |
| 无合集 | 200 | `{"data": []}` |

### TC-COLLECTION-003: 添加/移除文章

**接口**: `PUT /collections/:collectionId/articles`

| 测试场景 | 请求体 | 预期状态 | 预期响应 |
|----------|--------|----------|----------|
| 添加文章 | `{"article_id": "A1000001", "action": "add"}` | 200 | `{"message": "已添加到合集"}` |
| 移除文章 | `{"article_id": "A1000001", "action": "remove"}` | 200 | `{"message": "已从合集移除"}` |
| 重复添加 | 已存在的文章 | 200 | 幂等 |
| 移除不存在 | 不存在的文章 | 200 | 幂等 |
| 他人合集 | 非创建者 | 403 | `{"message": "无权操作他人的合集"}` |
| 合集不存在 | collectionId=INVALID | 404 | `{"message": "合集不存在"}` |

---

## 七、空间合集模块

### TC-SPACE-COLLECTION-001: 获取空间合集文章

**接口**: `GET /spaces/:spaceId/collections/:collectionId/articles`

| 测试场景 | 路径参数 | 预期状态 | 验证点 |
|----------|----------|----------|--------|
| 正常获取 | 有效ID | 200 | 返回合集信息和文章列表 |
| 非成员访问 | 非成员 | 403 | `{"message": "您不是该空间的成员"}` |
| 合集不存在 | collectionId=INVALID | 404 | `{"message": "合集不存在"}` |
| 合集不属于空间 | 不匹配的spaceId | 404 | 合集不存在 |
| 空合集 | 无文章 | 200 | `{"articles": []}` |

---

## 八、每日精选模块

### TC-DAILY-001: 获取每日精选

**接口**: `GET /spaces/:spaceId/daily-picks`

| 测试场景 | 路径参数 | 预期状态 | 验证点 |
|----------|----------|----------|--------|
| 正常获取 | 有效spaceId | 200 | 返回 `date`, `articles`（最多3篇） |
| 非成员访问 | 非成员 | 403 | `{"message": "您不是该空间的成员"}` |
| 无精选文章 | 空精选池 | 200 | `{"articles": []}` |
| 包含编辑高亮 | 有编辑高亮的文章 | 200 | 包含 `editorHighlights` 数组 |
| 包含用户状态 | 已登录用户 | 200 | 包含 `readProgress`, `isBookmarked` |

**验证轮换规则：**
- 同一天多次请求返回相同结果
- 不同空间同一天可能不同
- 跨天验证（修改日期或使用测试API）

### TC-DAILY-002: 每日一文

**接口**: `GET /daily-article`

| 测试场景 | 预期状态 | 验证点 |
|----------|----------|--------|
| 有空间有精选 | 200 | 返回单篇文章 |
| 无空间 | 200 | `{"article": null, "reason": "您还没有加入任何空间"}` |
| 有空间无精选 | 200 | `{"article": null, "reason": "暂无精选文章"}` |

---

## 九、阅读统计模块

### TC-STATS-001: 上报阅读统计

**接口**: `POST /stats/reading`

| 测试场景 | 请求体 | 预期状态 | 验证点 |
|----------|--------|----------|--------|
| 完整参数 | 见下方 | 200 | 返回今日统计 |
| 最简参数 | `{"article_id": "A1000001"}` | 200 | 其他字段使用默认值 |
| 缺少article_id | `{}` | 400 | `{"message": "article_id 不能为空"}` |
| 文章不存在 | `{"article_id": "INVALID"}` | 404 | `{"message": "文章不存在"}` |
| 边界值-时长 | `reading_time_seconds: 0` | 200 | 有效 |
| 边界值-深度 | `scroll_depth: 100` | 200 | 有效 |

**完整请求体示例：**
```json
{
  "article_id": "A1000001",
  "reading_time_seconds": 180,
  "scroll_depth": 85,
  "session_start": "2026-03-25T10:00:00.000Z",
  "session_end": "2026-03-25T10:03:00.000Z",
  "highlight_count": 3,
  "note_count": 1
}
```

### TC-STATS-002: 获取统计汇总

**接口**: `GET /stats/summary`

| 测试场景 | 查询参数 | 预期状态 | 验证点 |
|----------|----------|----------|--------|
| 全部统计 | 无/`period=all` | 200 | 返回累计统计 |
| 今日统计 | `period=today` | 200 | 仅今日数据 |
| 本周统计 | `period=week` | 200 | 最近7天 |
| 本月统计 | `period=month` | 200 | 最近30天 |
| 新用户 | 无任何数据 | 200 | 所有值为0 |

**响应字段验证：**
- `total_reading_time_seconds`
- `total_articles_read`
- `total_highlights`
- `total_notes`
- `reading_streak_days`

---

## 十、收藏列表模块

### TC-BOOKMARK-001: 获取收藏列表

**接口**: `GET /bookmarks`

| 测试场景 | 查询参数 | 预期状态 | 验证点 |
|----------|----------|----------|--------|
| 基础查询 | 无 | 200 | 返回 `list`, `total`, `page`, `pageSize` |
| 分页 | `page=1&page_size=10` | 200 | 正确分页 |
| 第二页 | `page=2&page_size=10` | 200 | 跳过前10条 |
| 无收藏 | 新用户 | 200 | `{"list": [], "total": 0}` |
| 大页码 | `page=9999` | 200 | `{"list": [], "total": 实际数量}` |

---

## 十一、批量同步模块

### TC-SYNC-001: 批量同步

**接口**: `POST /sync`

| 测试场景 | payload | 预期状态 | 验证点 |
|----------|---------|----------|--------|
| 同步高亮-创建 | `highlights: [{action: "create", ...}]` | 200 | 返回 `remote_id` |
| 同步高亮-删除 | `highlights: [{action: "delete", remote_id: ...}]` | 200 | status: success |
| 同步收藏 | `bookmarks: [{action: "create", ...}]` | 200 | 正确处理 |
| 同步阅读进度 | `read_progress: [{action: "update", ...}]` | 200 | 正确处理 |
| 同步阅读统计 | `reading_stats: [{action: "create", ...}]` | 200 | 正确处理 |
| 混合同步 | 多种类型混合 | 200 | 全部正确处理 |
| 空payload | `{}` | 200 | 返回空结果 |
| 部分失败 | 混合有效/无效数据 | 200 | 失败项 status: failed |

**完整请求体示例：**
```json
{
  "client_sync_id": "uuid-client-001",
  "last_sync_at": "2026-03-25T09:00:00.000Z",
  "payload": {
    "highlights": [
      {
        "local_id": "local-h-1",
        "action": "create",
        "data": {
          "article_id": "A1000001",
          "text": "高亮文字",
          "color": "#FFEB3B"
        }
      }
    ],
    "bookmarks": [
      {
        "local_id": "local-b-1",
        "action": "create",
        "data": {"article_id": "A1000001", "bookmarked": true}
      }
    ],
    "read_progress": [
      {
        "local_id": "local-r-1",
        "action": "update",
        "data": {"article_id": "A1000001", "progress": 80}
      }
    ],
    "reading_stats": [
      {
        "local_id": "local-s-1",
        "action": "create",
        "data": {
          "article_id": "A1000001",
          "reading_time_seconds": 120,
          "scroll_depth": 75
        }
      }
    ]
  }
}
```

### TC-SYNC-002: 增量获取

**接口**: `GET /sync/changes`

| 测试场景 | 查询参数 | 预期状态 | 验证点 |
|----------|----------|----------|--------|
| 获取全部变化 | `last_sync_at=2026-03-01T00:00:00.000Z` | 200 | 返回所有类型 |
| 筛选高亮 | `entity_types=highlights` | 200 | 仅高亮 |
| 筛选多类型 | `entity_types=highlights,bookmarks` | 200 | 指定类型 |
| 缺少参数 | 无 | 400 | `{"message": "last_sync_at 不能为空"}` |
| 无变化 | 最近的同步时间 | 200 | 空数组 |

---

## 十二、AI 对话模块

### TC-AI-001: AI 对话

**接口**: `POST /ai/chat`

| 测试场景 | 请求体 | 预期状态 | 验证点 |
|----------|--------|----------|--------|
| 正常对话 | `{"article_id": "A1000001", "message": "总结文章"}` | 200 | 返回 `reply` |
| 缺少article_id | `{"message": "test"}` | 400 | 参数错误 |
| 缺少message | `{"article_id": "A1000001"}` | 400 | 参数错误 |
| 文章不存在 | `{"article_id": "INVALID", "message": "test"}` | 404 | 文章不存在 |
| 未配置API Key | 服务端未配置 | 500 | `{"message": "AI 服务未配置"}` |

---

## 十三、管理后台 API

### TC-ADMIN-001: 每日精选管理

**接口**: 管理后台相关

| 接口 | 方法 | 测试场景 | 预期状态 |
|------|------|----------|----------|
| `/dr/spaces/:spaceId/daily-picks` | GET | 获取精选池 | 200 |
| `/dr/spaces/:spaceId/daily-picks` | POST | 添加到精选池 | 200 |
| `/dr/daily-picks/:pickId` | DELETE | 从精选池移除 | 200 |
| `/dr/daily-picks/:pickId/toggle` | PUT | 启用/禁用 | 200 |

### TC-ADMIN-002: 编辑高亮管理

| 接口 | 方法 | 测试场景 | 预期状态 |
|------|------|----------|----------|
| `/dr/articles/:articleId/editor-highlights` | GET | 获取编辑高亮 | 200 |
| `/dr/articles/:articleId/editor-highlights` | POST | 创建编辑高亮 | 200 |
| `/dr/editor-highlights/:highlightId` | PUT | 更新编辑高亮 | 200 |
| `/dr/editor-highlights/:highlightId` | DELETE | 删除编辑高亮 | 200 |

---

## 十四、边界与异常测试

### TC-EDGE-001: 认证相关

| 测试场景 | 请求 | 预期状态 | 预期响应 |
|----------|------|----------|----------|
| 无Token | 不带Authorization | 401 | 未授权 |
| 无效Token | `Authorization: Bearer invalid` | 401 | Token无效 |
| 过期Token | 过期的JWT | 401 | Token过期 |
| 篡改Token | 修改payload | 401 | Token无效 |

### TC-EDGE-002: 参数边界

| 测试场景 | 接口 | 参数 | 预期行为 |
|----------|------|------|----------|
| 超大分页 | GET /articles | page_size=1000 | 限制为合理值或正常返回 |
| 负数分页 | GET /articles | page=-1 | 默认为1或报错 |
| 超长文本 | POST /highlights | text=10000字符 | 正常处理或限制 |
| 特殊字符 | POST /collections | name="<script>" | 转义处理 |
| SQL注入 | POST /sms/send | phone="'; DROP TABLE" | 参数化查询防护 |

### TC-EDGE-003: 并发测试

| 测试场景 | 操作 | 预期行为 |
|----------|------|----------|
| 同时收藏 | 同一用户同时收藏同一文章 | 幂等，最终收藏状态 |
| 同时创建合集 | 同名合集同时创建 | 创建两个独立合集 |
| 同时更新进度 | 同一文章同时更新不同进度 | 最后一次更新生效 |

### TC-EDGE-004: 数据一致性

| 测试场景 | 操作 | 验证点 |
|----------|------|--------|
| 删除文章 | 删除被收藏的文章 | 收藏列表不返回 |
| 删除用户 | 删除用户（如有） | 级联处理相关数据 |
| 删除空间 | 删除空间 | 成员关系清理 |

---

## 十五、性能测试建议

### 15.1 接口响应时间

| 接口 | 预期响应时间 | 测试条件 |
|------|--------------|----------|
| GET /articles | < 200ms | 100条数据 |
| GET /spaces/:id/homepage | < 300ms | 10个模块 |
| POST /sync | < 500ms | 100个同步项 |
| POST /ai/chat | < 5s | 取决于AI服务 |

### 15.2 并发测试

- 100 并发用户同时请求首页
- 50 并发用户同时同步数据
- 10 并发用户同时上报统计

---

## 十六、测试执行清单

### 16.1 冒烟测试（必测）

- [ ] 用户登录获取Token
- [ ] 获取空间首页
- [ ] 获取文章列表和详情
- [ ] 创建/删除批注
- [ ] 收藏/取消收藏文章
- [ ] 批量同步接口
- [ ] 阅读统计上报

### 16.2 回归测试（每次发布）

- [ ] 全部 P1 接口
- [ ] 全部 P2 接口
- [ ] 边界测试
- [ ] 错误处理

### 16.3 自动化测试建议

```bash
# 使用 curl 进行基础测试
curl -X POST http://localhost:3000/api/v1/dr/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","code":"888888"}'

# 使用 Newman 运行 Postman 集合
newman run deepread-api-tests.postman_collection.json

# 使用 Jest 进行单元测试
npm test -- --coverage
```

---

## 十七、测试报告模板

```
测试报告
========

测试日期: YYYY-MM-DD
测试人员: XXX
测试环境: 开发/测试/预发

测试结果汇总:
- 通过: XX
- 失败: XX
- 阻塞: XX
- 跳过: XX

失败用例详情:
1. TC-XXX-XXX: [失败原因]
2. ...

风险与建议:
- ...
```
