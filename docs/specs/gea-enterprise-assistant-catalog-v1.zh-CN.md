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
- Assignment 的可选 `extensions` 是已接受增量的服务端投影，只包含 Skill/MCP 稳定 ID、版本和冲突状态；模板升级不得静默删除该状态。
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

## AionCore 客户端接缝

AionUi Renderer 不直接访问 GEA。AionCore 负责身份、租户上下文、GEA 调用和目录投影，并沿用现有助手 API：

```text
GET  /api/assistants
GET  /api/assistants/{assistant_id}
POST /api/assistants/{assistant_id}/extensions
POST /api/conversations/prepare
POST /api/conversations
```

前两个接口在企业助手上返回 `source = managed` 和 `managed` 元数据；标准 AionUi 助手响应保持不变。扩展保存请求体严格等于 `EnterpriseAssistantExtensionRequest`，路径中的 `assistant_id` 不重复进入请求体。

扩展写入必须满足：

1. `expected_revision` 和 `template_version` 同时参与乐观并发校验。
2. `idempotency_key` 在同一租户和 Assignment 内唯一；相同 key 重放必须返回相同结果。
3. 服务端只接受稳定 Skill/MCP ID，不接收本地路径、环境变量、凭据或完整 MCP 配置。
4. `accepted` 后将结果写回 Assignment 的 `extensions`；模板升级时重新校验并保留合法项，冲突项以 `status = attention` 和 `violations` 返回。
5. `unknown_external_write` 不可自动重试；客户端保留草稿并提示核验。

## 原子会话准备与运行快照

`POST /api/conversations/prepare` 接收 `ConversationPreparationRequest`。AionCore 在同一权限上下文中解析 Assignment、模板、用户增量、Agent、Skill、MCP 授权和运行策略；只有全部通过时才返回带有效期的 opaque `preparation_id + revision` 以及完整 `ConversationConfigurationSnapshot`。任何必需依赖失败只返回 `blocked + issues`，不得发布部分配置。

客户端随后向 `POST /api/conversations` 仅提交 `{ preparation: { id, revision } }`，不得自行回传或重组快照。AionCore 必须在一次原子事务中消费仍有效且属于当前身份的 preparation、创建会话并把同一份快照写入会话记录；过期、身份变化或 revision 不一致均拒绝创建。相同 `idempotency_key` 的准备请求必须返回相同结果，创建操作重复消费同一 preparation 时也不得产生第二个会话。

标准助手通过客户端同一个 `ConversationPreparation` 接口进入 ready 状态；没有企业目录时不发额外网络请求，创建请求与现状等价。

每个新 Turn 仍通过既有消息发送入口执行。AionCore 在开始执行前对会话绑定的配置做轻量有效性复核：

1. 已开始和历史 Turn 永远按其绑定的快照解释，模板升级不得回写历史事实。
2. 新配置可原子发布为新的 snapshot revision；下一个尚未开始的 Turn 才可绑定新 revision。
3. 身份、Assignment、策略或必需能力失效时，新 Turn 返回稳定阻断码和修复动作，不得降级成部分启用执行。
4. 快照只保存稳定引用、版本、来源、授权状态和策略，不保存 token、Cookie、环境变量或完整 MCP 配置。

可执行事实源位于：

- `packages/desktop/src/common/types/conversationConfiguration.ts`
- `packages/desktop/src/common/adapter/conversation/preparation.ts`
- `tests/fixtures/conversationConfiguration.ts`

## 客户端验收 Fixture

Fixture 固定覆盖首次加载、空目录、可选/强制分配、升级成功/失败、缺依赖、MCP 待授权、扩展允许/冲突/拒绝、暂停、撤回、离线 last-good、身份/策略变化、客户端版本过低和未知外部写入结果。新增状态必须先增加 Fixture 和契约测试，再修改生产实现。
