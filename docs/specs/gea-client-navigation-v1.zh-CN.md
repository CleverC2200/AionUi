# GEAUi Client Navigation V1 接入规范

状态：AionUi 客户端已实现并通过模拟契约、单元测试、构建及 macOS 安装包 Scheme 唤醒验证；真实飞书新消息到指定 Agent
会话的完整生产链路，以及 Windows 新安装包，仍需联合验收。机器可读契约见
[`gea-client-navigation-v1.openapi.json`](./gea-client-navigation-v1.openapi.json)。GEA 服务端字段和能力开关以《Client Navigation 与
GEAUi 唤醒接入规范》v1.5 或更新版本为权威，本文件只冻结 AionUi 与 AionCore 的客户端边界。

## 当前范围

- V1：打开当前用户有权访问的指定 Agent，并在本地显示其 Conversation。
- V2：定位 Interaction Request，当前生产必须保持关闭；AionUi V1 resolve schema 会拒绝 V2 响应。
- 飞书只发送 HTTPS Landing。Landing 的 Fragment 保存 Reference；只有用户点击按钮后才构造 Scheme。
- AionUi 不解析 Reference、不接收身份或租户覆盖、不执行服务端提供的任意 URL/route。

```text
飞书卡片
  -> https://<gea-host>/aiportal/client-launch#ref=<opaque>&v=1&profile=production
  -> 用户点击“打开 GEAUi”
  -> aionui://open-conversation?ref=<opaque>&v=1
  -> GEAUi / AionCore resolve
  -> GEA V1 AGENT target
  -> AionCore 创建或恢复本地 Conversation
  -> GEAUi 显示 Conversation
  -> AionCore 转发 TARGET_VISIBLE / SUCCESS ACK
```

## Scheme 契约

正式 Scheme：

```text
aionui://open-conversation?ref=<opaque>&v=1
```

约束：

- `ref` 长度 1 至 512，只允许 `[A-Za-z0-9._-]`；原值不得写入日志。
- `v` 必须为 `1`；未知 action、重复参数、未知参数、非法百分号编码、userinfo、port、path、fragment 均拒绝。
- 当前客户端为兼容早期联调链接仍允许可选 `profile`，但正式 gea-web 不应将 Landing 的 `profile` 透传进 Scheme。
- 链接不得包含 Agent、Conversation、Interaction Request、用户、租户、Token、Cookie 或任意路由。

## AionCore 本地 resolve

GEAUi 调用：

```http
POST /api/deep-links/resolve
```

```json
{
  "navigation_reference": "reference.safe_123456",
  "schema_version": 1
}
```

AionCore 使用当前登录用户调用 GEA Gateway resolve，严格校验 V1 `AGENT` target，创建或恢复对应 Agent 的 Gateway Session，然后只向
GEAUi 返回本地闭合目标：

```json
{
  "navigation_intent_id": "intent-1",
  "schema_version": 1,
  "target": {
    "type": "conversation",
    "conversation_id": "local-conversation-1"
  },
  "expires_at": "2099-09-01T12:00:00Z",
  "trace_id": "trace-1"
}
```

所有字段必填，未知字段拒绝。V1 的 `target` 只能包含 `type` 和 `conversation_id`；不得返回 `assistant_id`、`agentCode`、URL、route、
Reference 或凭据。GEAUi 只按 `conversation_id` 打开现有 Conversation 路由。

## 目标可见 ACK

Conversation 已加载且页面确认目标可见后，GEAUi 调用：

```http
POST /api/deep-links/ack
```

```json
{
  "navigation_intent_id": "intent-1",
  "idempotency_key": "gea-ui-<stable-random-key>"
}
```

AionCore 将其转换为 GEA 请求：

```http
POST /ai/gateway/client-navigation-intents/{intentId}/ack
```

```json
{
  "stage": "TARGET_VISIBLE",
  "result": "SUCCESS",
  "idempotencyKey": "gea-ui-<stable-random-key>"
}
```

一次导航生命周期内重试必须复用同一幂等键。客户端只对网络错误、`429` 和 `5xx` 做有限重试；ACK 成功后才从客户端 FIFO 移除当前
Reference。打开进程、resolve 成功或仅改变路由均不算目标可见。

## 客户端状态机

- 冷启动参数、macOS `open-url`、Windows 二次启动参数统一进入同一严格解析器。
- 同一 Reference 去重；不同 Reference 按 FIFO 执行；当前项加等待项总数最多 16。
- 内存任务 10 分钟过期，不持久化原始 Reference。
- 未登录或 AionCore 未就绪时保留任务；登录态变化会终止旧任务并以稳定错误码上报。
- terminal 错误移除当前任务并推进队列；短暂技术错误保留当前任务，等待新的登录态或页面生命周期重试。
- 日志只记录 Reference 的 SHA-256、阶段、平台、客户端版本、schema 版本和稳定结果码。

## 职责边界

| 责任方        | 负责                                                                                 | 不负责                                        |
| ------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| GEA / gea-web | 签发、Landing、当前身份 resolve、权限/过期/撤销、ACK 审计、能力与灰度开关            | 不向 Scheme 下发业务 ID 或凭据                |
| AionCore      | 当前登录身份调用 GEA；校验 V1 AGENT；准备本地 Conversation；转发 ACK                 | 不接受客户端身份/租户覆盖，不返回任意导航 URL |
| AionUi        | Scheme 注册、单实例转发、有界 FIFO、严格本地 schema、打开 Conversation、目标可见 ACK | 不解析 Reference，不把进程唤醒当成业务成功    |

## 验证

客户端定向门禁：

```bash
bun run test tests/integration/deep-link-platform-contract.test.ts \
  tests/unit/common-platform/deepLink.test.ts \
  tests/unit/process/deepLink.test.ts \
  tests/unit/renderer/deepLink.dom.test.tsx
```

真实联合验收必须另外记录同一条链路的脱敏 GEA trace、AionCore trace 与客户端 Reference hash：

1. 新飞书消息的 HTTPS Landing 只在 Fragment 携带 `ref/v/profile`，点击后 Scheme 只含 `ref/v`。
2. macOS 与 Windows 安装包分别验证冷启动、热启动、最小化唤醒及单实例转发。
3. 已登录进入正确 Agent Conversation；未登录续跳、换用户、过期、撤销、越权、错误版本均 fail closed。
4. 重复点击去重，多条链接 FIFO，队列上限和 10 分钟过期行为正确。
5. 只有目标可见后发送 ACK，失败重试复用同一幂等键。
6. 抓包与日志确认 Reference、用户信息、业务目标和凭据均未泄露。

本地 Mock、静态检查、构建或仅验证 Scheme 唤醒，均不能替代以上生产验收。
