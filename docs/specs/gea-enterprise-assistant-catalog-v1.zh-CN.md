# GEA 企业助手目录契约 V1

## 目标

本契约定义 GEA 与 AionUi 客户端之间的受管助手目录及用户辅助能力增量语义。客户端先按此契约实现，GEA 服务端后续提供对应接口。可执行事实源位于：

- `packages/desktop/src/common/types/agent/enterpriseAssistantCatalog.ts`
- `tests/fixtures/enterpriseAssistantCatalog.ts`

文档不重复维护字段定义；字段、枚举和约束以可执行 Schema 为准。

## 版本与快照

- `schema_version = 1`。新增可选字段不升级版本，客户端忽略未知字段。
- 删除字段、修改字段含义或收紧既有取值属于破坏性变化，必须升级 `schema_version`。
- 目录响应始终返回完整快照或 `not_modified`，不返回需要客户端拼接的部分补丁。
- 每次内容变化必须生成新的 `revision`；同一模板内容变化必须生成新的 `template_version`。
- `assignment_id` 不得改指其他 `template_id`。撤回后需要重新分配时生成新 Assignment。

## 权限分工

- GEA 管理模板身份、系统指令、Agent、默认模型/权限、必需 Skill/MCP 和分配状态。
- 客户端不得修改、删除、降级或遮蔽企业配置。
- 用户只可提交 `user_extensions` 允许的辅助 Skill/MCP；GEA 返回最终接受或逐项拒绝结果。
- 客户端本地 Schema 只做快速反馈，不代表企业授权。

## 安全要求

- 目录、错误详情和用户扩展响应不得携带 token、Cookie、Authorization、密码、API key、access key 或其他 secret。
- MCP 只分发稳定引用和 `auth_mode`。本地凭据、OAuth 会话和企业委派凭据由各自安全存储或运行时持有。
- `unknown_external_write` 表示写入结果无法确认，`retryable` 必须为 `false`；客户端先核验，不自动重试。

## 同步与错误

- 客户端请求携带当前 ETag/revision；未变化时服务端返回 `not_modified`。
- 客户端只在完整响应通过 Schema、敏感字段和快照迁移校验后替换 last-good。
- `retryable_read` 可由客户端显式重试；`user_action`、`admin_action` 和 `unknown_external_write` 不得自动重试。
- 离线或可重试读取失败时可展示 last-good，但必须标记陈旧；缓存不能冒充当前授权。

## GEA 建议接口

```text
GET  /aidata/assistant-catalog/my?revision=<current>
POST /aidata/assistant-catalog/my/extensions/validate
```

请求沿用现有飞书登录的 `X-Access-Token` 与租户上下文。具体 URL 可调整，但响应必须通过可执行 Schema。

## 客户端验收 Fixture

Fixture 固定覆盖首次加载、空目录、可选/强制分配、升级成功/失败、缺依赖、MCP 待授权、扩展允许/冲突/拒绝、暂停、撤回、离线 last-good、身份/策略变化、客户端版本过低和未知外部写入结果。新增状态必须先增加 Fixture 和契约测试，再修改生产实现。
