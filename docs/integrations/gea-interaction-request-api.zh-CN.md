# GEA 待办接入接口 V1

本文给 GEA 开发同事使用。目标是让受信业务流程在 GEA 创建权威待办，由 AionCore 拉取并投影到 AionUi；用户处理后，AionCore 将动作回传 GEA，并用权威回执恢复原会话的同一个 Turn。

## 1. 系统边界

- GEA 是待办的事实源，负责创建幂等、状态、版本、有效期、允许动作、动作回执和审计。
- AionCore 使用当前 Gateway session 拉取完整 pending 快照，并把用户动作转发给 GEA。
- AionUi 不直接调用 GEA，也不维护第二套审批状态。
- GEA 不需要向 Renderer 发 WS。AionCore 发现权威快照变化后，向客户端发送 `interactionRequest.changed`，客户端再读取完整 pending 列表。

## 2. GEA 需要提供的接口

### 2.1 创建待办（GEA 内部受信接口，待双方冻结路径）

建议路径：

```http
POST /ai/internal/interaction-requests
Idempotency-Key: create:erp:payment:PAY-20260812-001:cost-center
Content-Type: application/json
```

创建接口必须由 GEA 的受信业务身份调用，不对 AionUi 或普通客户端开放。相同 `tenant + Idempotency-Key` 的重放必须返回相同 `requestId` 和版本，不得创建第二条待办。

question 示例：

```json
{
  "gatewaySessionId": "gea-session-1",
  "kind": "question",
  "title": "请选择成本中心",
  "summary": "ERP 付款申请缺少成本中心",
  "sourceLabel": "ERP",
  "allowedActions": ["answer", "decline"],
  "expiresAt": "2026-08-18T18:00:00+08:00",
  "presentation": {
    "type": "question",
    "questions": [
      {
        "header": "成本中心",
        "question": "本次付款应归属哪个成本中心？",
        "multiSelect": false,
        "options": [
          { "label": "CC-100", "description": "华东销售" },
          { "label": "CC-200", "description": "总部职能" }
        ]
      }
    ]
  }
}
```

permission 示例：

```json
{
  "gatewaySessionId": "gea-session-1",
  "kind": "permission",
  "title": "确认提交 OA",
  "summary": "仅允许执行一次测试环境提交",
  "sourceLabel": "OA",
  "allowedActions": ["proceed_once", "reject_once"],
  "presentation": {
    "type": "permission",
    "title": "确认提交 OA",
    "description": "将已复核的付款申请提交到测试环境。",
    "operation": "execute",
    "detail": "PAY-20260812-001",
    "options": [
      { "label": "允许一次", "value": "proceed_once" },
      { "label": "拒绝", "value": "reject_once" }
    ]
  }
}
```

建议创建响应：

```json
{
  "success": true,
  "result": {
    "requestId": "ir_01K2...",
    "version": "v1",
    "status": "pending",
    "created": true
  }
}
```

`created=false` 表示创建幂等重放；返回的 `requestId` 和 `version` 必须与首次结果一致。

### 2.2 拉取完整 pending 快照（AionCore 已按此调用）

```http
POST /ai/gateway/interaction-requests/list
X-Access-Token: <GEA 登录态>
X-Tenant-Id: <tenant>
Content-Type: application/json
```

```json
{
  "agentCode": "enterprise-payment-review",
  "sessionId": "gea-session-1",
  "conversationId": "gea-conversation-1",
  "delegationToken": "<opaque>",
  "status": "pending"
}
```

响应必须是当前 Gateway session 的完整 pending 集合，不是增量：

```json
{
  "success": true,
  "result": {
    "revision": "pending-r17",
    "items": [
      {
        "id": "ir_01K2...",
        "version": "v1",
        "status": "pending",
        "kind": "question",
        "title": "请选择成本中心",
        "summary": "ERP 付款申请缺少成本中心",
        "sourceLabel": "ERP",
        "allowedActions": ["answer", "decline"],
        "expiresAt": "2026-08-18T18:00:00+08:00",
        "updatedAt": "2026-08-17T10:00:10+08:00",
        "presentation": {
          "type": "question",
          "questions": [
            {
              "header": "成本中心",
              "question": "本次付款应归属哪个成本中心？",
              "multiSelect": false,
              "options": [{ "label": "CC-100" }]
            }
          ]
        }
      }
    ]
  }
}
```

只要集合、请求内容、状态或版本变化，`revision` 就必须变化。相同权威快照应返回相同 `revision`。

### 2.3 处理待办（AionCore 已按此调用）

```http
POST /ai/gateway/interaction-requests/action
X-Access-Token: <GEA 登录态>
X-Tenant-Id: <tenant>
Content-Type: application/json
```

question answer 示例：

```json
{
  "agentCode": "enterprise-payment-review",
  "sessionId": "gea-session-1",
  "conversationId": "gea-conversation-1",
  "delegationToken": "<opaque>",
  "requestId": "ir_01K2...",
  "expectedVersion": "v1",
  "idempotencyKey": "interaction:ir_01K2:v1:answer",
  "actionId": "answer",
  "payload": {
    "answers": [
      {
        "question": "本次付款应归属哪个成本中心？",
        "labels": ["CC-100"]
      }
    ]
  }
}
```

permission 示例只允许提交服务端当前版本 `allowedActions` 中的值：

```json
{
  "agentCode": "enterprise-payment-review",
  "sessionId": "gea-session-1",
  "conversationId": "gea-conversation-1",
  "delegationToken": "<opaque>",
  "requestId": "ir_permission_01",
  "expectedVersion": "v3",
  "idempotencyKey": "interaction:ir_permission_01:v3:proceed_once",
  "actionId": "proceed_once"
}
```

成功回执：

```json
{
  "success": true,
  "result": {
    "receiptId": "receipt_01K2...",
    "requestId": "ir_01K2...",
    "version": "v2",
    "status": "accepted",
    "resolvedAt": "2026-08-17T10:01:00+08:00",
    "resolvedBy": "user-123",
    "auditId": "audit-456"
  }
}
```

`status` 只能是：

- `accepted`：本次动作已成功接受。
- `already_resolved`：相同业务动作已完成；返回首次权威结果。
- `conflict`：`expectedVersion` 过期。
- `expired`：请求已过期。
- `forbidden`：身份、session 或动作不允许。
- `unknown_external_write`：外部写入结果未知，必须进入核验状态，禁止自动重试。

`conflict`、`expired`、`forbidden` 建议在回执的 `request` 字段返回最新完整请求；若不返回，AionCore 会立即重新调用 list 获取权威快照。

## 3. 强制校验规则

- `requestId`、`version`、`revision`、`actionId`、`idempotencyKey` 必须是 1–240 个字符的非空字符串。
- `updatedAt`、`expiresAt`、`resolvedAt` 使用带时区的 RFC 3339。
- pending 快照只能包含 `status=pending`，同一快照中 `requestId` 不得重复。
- question 必须有非空 `questions`，并同时允许 `answer`、`decline`；每个问题必须有非空 options。
- permission 的每个 option.value 必须存在于当前版本 `allowedActions`。
- 动作必须校验 tenant、登录用户、Gateway session、delegation、request、`expectedVersion` 和 `allowedActions`。
- 相同 `request + version + action` 的并发或重放最多执行一次来源系统写入；相同 `idempotencyKey` 必须返回相同回执。
- 对由 Aionrs 工具调用创建的待办，GEA 在返回 `accepted` 或 `already_resolved` 前必须释放原先等待该待办结果的 Gateway 工具调用，并把同一份权威回执返回给该调用。AionCore 会校验原 Turn 仍存活，但不会再注入第二条消息；否则会造成原 Turn 无法继续或重复消费结果。
- `unknown_external_write` 未完成核验前，不得再次调用来源系统，也不得报告成功。

## 4. 敏感信息边界

请求快照和回执不得包含以下字段或其变体：`Authorization`、`Cookie`、密码、access key、API key、secret、token。AionCore 会递归扫描，发现后按无效上游响应拒绝整次快照或回执。

日志仅记录 tenant、request ID、version、action ID、receipt ID、audit ID、状态和错误码；不得记录 delegation token、登录 token、完整 payload 或业务附件。

## 5. 联调验收

GEA 提供测试租户和固定 question/permission Fixture，至少覆盖：

1. 重复创建返回同一 request ID 和版本。
2. list 返回完整 pending 集合；变化时 revision 变化。
3. accepted 后请求退出 pending，重复动作返回同一业务结果且不重复写来源系统。
4. 旧版本、过期、无权和非法 action 分别返回稳定状态。
5. permission 外部写入结果未知时进入 `unknown_external_write`，核验前不重试。
6. 响应敏感字段扫描通过。
7. AionCore 收到 accepted/already_resolved 后，客户端待办消失，并向原会话的同一个 Turn 投递权威回执。

当前 AionCore 已实现 list/action 调用、持久化投影、按用户 WS 通知、版本与动作门禁、并发幂等和原 Turn 恢复。GEA 侧尚需实现并部署上述权威创建、快照、动作与核验模块，之后才能进行真实测试租户闭环。
