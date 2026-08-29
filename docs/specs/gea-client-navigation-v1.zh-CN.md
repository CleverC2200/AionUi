# GEA 客户端导航引用协议 v1

状态：客户端已实现、模拟平台已验证；GEA 管理端和真实 AionCore 尚未联调。机器可读契约见
[`gea-client-navigation-v1.openapi.json`](./gea-client-navigation-v1.openapi.json)。

## 目标与边界

飞书消息或待办只发送 HTTPS 落地页。落地页经用户动作打开：

```text
aionui://open-conversation?ref=<opaque>&v=1&profile=<environment-key>
```

客户端只信任协议形状，不信任链接内容。`ref` 是短期、不透明、可撤销且可重复解析的 Navigation Reference；链接不得包含路由、
`conversation_id`、`assistant_id`、消息内容、外部身份、token、Cookie 或其他凭据。用户登录后，AionUi 把 `ref` 交给本地
AionCore，由 AionCore 结合当前 Core Session 和外部身份映射完成校验及本地目标映射。

```text
飞书卡片 -> HTTPS 落地页 -> aionui://...ref... -> AionUi
                                                |
                                                v
                                   POST /api/deep-links/resolve
                                                |
                                当前 Core Session / Lark 外部身份
                                                |
                                                v
                         GEA resolve -> 业务目标 -> AionCore 本地目标映射
```

## 职责拆分

| 责任方     | 必须负责                                                                                                | 明确不负责                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| GEA 管理端 | 签发、幂等、过期、撤销、收件人/租户绑定；HTTPS 落地页；飞书卡片                                         | 不生成本地路由，不下发 Core ID，不在 GET/HEAD 预览时解析或消费引用 |
| AionCore   | 使用当前 Core Session 调 GEA resolve；校验外部身份、租户、环境、授权；将业务标识映射成本地 typed target | 不接受客户端传入的身份/租户覆盖，不返回任意 route/URL              |
| AionUi     | 注册协议；排队和去重；登录后解析；只执行闭合 typed target；到达精确目标后 ACK                           | 不解析 `ref`，不缓存凭据，不把打开页面等同于业务处理完成           |
| 联调负责人 | 固定环境、测试身份与测试数据；汇总 trace；分别记录 Mock 与真实验收                                      | 不以单测、构建或模拟平台通过代替真实 GEA/飞书验收                  |

## 管理端接口

### 1. 签发引用

`POST /api/v1/internal/client-navigation-intents`

- 仅服务身份可调用，并要求 `Idempotency-Key`。
- 同一收件人和幂等键返回同一签发结果；同键不同请求应返回冲突，不得悄悄改写目标。
- 请求包含 `recipient`、`environmentKey`、业务 `target` 和 `expiresInSeconds`。
- 响应包含 `navigationReference`、`clientUrl`、`landingUrl`、`expiresAt`。
- 推荐默认 TTL 15 分钟，允许范围 60 秒至 24 小时。

### 2. 当前用户解析

`POST /ai/gateway/client-navigation-intents/resolve`

- 只接收 `navigationReference` 和 `schemaVersion`；身份、租户从当前 GEA 用户会话取得。
- 解析是只读且可重放的，直到过期或撤销；页面预览不能消费引用。
- 响应返回受授权的业务 target 和 `environmentKey`，AionCore 再映射本地标识。
- 无权访问统一返回稳定错误，不返回目标是否存在、标题、正文或其他用户信息。

### 3. HTTPS 落地页

落地页的 GET/HEAD 只返回通用标题、说明和“打开 GEA 客户端”按钮。爬虫预览、浏览器预取或刷新不得调用 resolve、不得改变
引用状态。按钮必须由用户动作触发自定义协议，同时提供“未安装客户端”说明。

## AionCore 本地接口

`POST /api/deep-links/resolve`

请求：

```json
{
  "navigation_reference": "nav_opaque",
  "schema_version": 1
}
```

成功响应只允许以下闭合类型：

| `target.type`         | 必填本地字段                                                                                 | 客户端到达条件                 |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------ |
| `conversation`        | `conversation_id`, `assistant_id`                                                            | 会话加载且 Assistant 一致      |
| `message`             | 上述字段及 `message_id`                                                                      | 消息锚点加载、滚动并聚焦       |
| `interaction_request` | 上述字段及 `interaction_request_id`；可带 `message_id`；团队位置须成对带 `team_id`/`slot_id` | 原始交互卡加载并聚焦           |
| `team`                | `team_id`                                                                                    | 团队加载                       |
| `slot`                | `team_id`, `slot_id`, `conversation_id`, `assistant_id`                                      | 团队成员身份和 Slot 一致并切换 |

响应不得出现 `route`、`url`、`token` 或自由导航参数。AionUi 使用 snake_case 契约；GEA 管理端使用 camelCase 契约，转换边界属于
AionCore。

## 稳定错误码

| 错误码                           | HTTP 建议 | 是否终止当前引用 | 说明                                           |
| -------------------------------- | --------- | ---------------- | ---------------------------------------------- |
| `NAVIGATION_REFERENCE_EXPIRED`   | 410       | 是               | 已过期                                         |
| `NAVIGATION_REFERENCE_REVOKED`   | 410       | 是               | 已撤销                                         |
| `NAVIGATION_REFERENCE_FORBIDDEN` | 403       | 是               | 当前身份或租户无权访问                         |
| `NAVIGATION_REFERENCE_NOT_FOUND` | 404       | 是               | 不存在；不得泄漏更多信息                       |
| `NAVIGATION_SCHEMA_UNSUPPORTED`  | 400       | 是               | 版本不支持                                     |
| `DEEP_LINK_PROFILE_MISMATCH`     | 409       | 是               | 环境不匹配                                     |
| `DEEP_LINK_ASSISTANT_MISMATCH`   | 409       | 是               | 本地会话与 Assistant 不一致                    |
| `DEEP_LINK_TARGET_NOT_FOUND`     | 404       | 是               | 授权后仍无法映射本地目标                       |
| `DEEP_LINK_RESOLVE_FAILED`       | 503       | 否               | 短暂技术失败，可在新的登录态或页面生命周期重试 |

日志只记录 `ref` 的 SHA-256、阶段、平台、客户端版本、schema 版本、稳定结果码和双方 `trace_id`；不得记录原始引用、完整链接、
用户身份或目标内容。

## 联调验收

### 模拟平台门禁

- 签发结果只在 URL 暴露不透明 `ref`、版本和环境键。
- 幂等签发、重复解析、过期、撤销、未知引用、错误身份、错误环境和错误 schema 均有自动化用例。
- `DeepLinkResolveResponse` 通过客户端 Zod schema；任意 route 或多余字段被拒绝。
- Conversation、Message、Interaction Request、Team、Slot 五种目标均有客户端导航契约测试。
- 多条热启动只执行当前一条并保留最新待执行引用；登录身份变化后旧响应不得导航。

运行：

```bash
bun run test tests/integration/deep-link-platform-contract.test.ts \
  tests/unit/common-platform/deepLink.test.ts \
  tests/unit/process/deepLink.test.ts \
  tests/unit/renderer/deepLink.dom.test.tsx
```

### 真实联调门禁

以下各项必须保存 GEA/AionCore/AionUi 同一条测试链路的脱敏 trace，且不得用模拟结果替代：

1. GEA 签发 -> 飞书真实卡片 -> HTTPS 落地页 -> 已安装 macOS 客户端冷/热启动。
2. 未登录时保留引用，登录后才解析；切换用户、租户和环境均 fail closed。
3. 五种目标各完成一次真实映射和精确到达；目标不存在和 Assistant 不匹配返回稳定错误。
4. 引用过期、撤销、重复点击、并发点击及客户端重启行为与本规范一致。
5. Windows 协议注册、冷启动和单实例转发单独验收。
6. 抓包和日志检查确认 URL、落地页、客户端日志中没有凭据、内容或本地目标标识。

## 联调交接材料

- GEA：OpenAPI 实现版本、签发调用方、落地页地址、TTL/撤销策略、测试身份与 trace 查询方式。
- AionCore：GEA client 配置、External Identity Mapping 证据、业务目标到本地 target 的映射表、错误码映射。
- AionUi：客户端版本/SHA、安装包、协议注册检查结果、五类目标截图或录像、客户端 trace hash。
- 联调负责人：一张按用例记录“管理端 trace / Core trace / 客户端 hash / 结果 / 剩余问题”的验收表。
