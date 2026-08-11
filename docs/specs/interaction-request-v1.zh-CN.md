# 来源权威的待处理请求契约 V1

## 边界

`InteractionRequest` 是 Agent、Team 成员、AionCore 或业务系统暂停原 Turn 后发布的待处理请求。来源系统维护状态、版本、有效期、允许动作和最终结果；AionUi 只投影待处理列表并把用户带回原会话、原消息，不创建第二套任务或审批状态。

可执行事实源：

- `packages/desktop/src/common/types/interactionRequest.ts`
- `packages/desktop/src/common/adapter/interactionRequest/actions.ts`

## AionCore 接口

```text
GET  /api/interaction-requests?status=pending
POST /api/interaction-requests/{request_id}/actions
WS   interaction_request.changed
```

动作请求必须携带 `expected_version + idempotency_key + action_id`。路径中的 `request_id` 不重复进入请求体。相同 request、version、action 的重放必须返回同一业务结果，不得执行第二次外部写入。

## 收敛规则

1. 列表是来源权威的完整待处理投影；重启和重连后重新读取，不依赖 Renderer 内存恢复。
2. 会话内继续复用现有 question/permission 卡；携带 `interaction_request` 元数据时改走统一动作接口，旧消息仍走原接口。
3. `accepted` 和 `already_resolved` 是成功回执；`conflict`、`expired`、`forbidden` 要刷新权威状态。
4. `unknown_external_write` 必须显示“需核验”，客户端缓存该终态且禁止自动重试。
5. 点击顶层“待处理”条目导航到 `conversation_id + message_id`，由现有消息锚点加载并高亮原请求；处理成功后由原 Turn 继续运行。
6. 请求与回执不得携带 token、Cookie、Authorization、密码、API key、环境变量或完整 MCP 配置。

Team 成员和单 Agent 的差异只体现在 `source.type`，交互协议与回执语义完全一致。
