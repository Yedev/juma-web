# TODO: DeepRead 接口清理与补全

## 1. 需要新增的接口（Flutter 客户端已调用，服务端缺失）

- [ ] `GET /api/v1/dr/spaces/:spaceId/collections/:collectionId/articles` — 获取 Space 下 Collection 的文章列表

## 2. 计划中接口（Flutter 代码已注释，暂不实现）

- [x] `POST /api/v1/dr/sync/export` — 导出用户数据 ✓
- [x] `POST /api/v1/dr/sync/import` — 导入用户数据 ✓
- [ ] `POST /api/v1/analytics/events` — 上报分析事件

## 3. ~~服务端需要清除的接口~~ 已完成 ✓

以下 8 个 Flutter 客户端未使用的接口已全部清除（删除路由、服务函数及相关文件）：

- [x] `PUT /highlights/:highlightId` — 更新高亮
- [x] `DELETE /highlights/:highlightId` — 删除高亮
- [x] `GET /bookmarks` — 获取收藏列表
- [x] `POST /reading-stats` — 提交阅读统计
- [x] `POST /reading-stats/batch` — 批量提交阅读统计
- [x] `GET /stats/summary` — 阅读统计摘要
- [x] `POST /sync` — 批量同步
- [x] `GET /sync/changes` — 增量拉取变更

已删除文件：`routes/dr/stats.ts`、`routes/dr/sync.ts`、`services/deepread/drStatsService.ts`、`services/deepread/drSyncService.ts`

## 4. Admin 管理界面

- [x] 用户管理 → 展开行查看同步备份数据 ✓
