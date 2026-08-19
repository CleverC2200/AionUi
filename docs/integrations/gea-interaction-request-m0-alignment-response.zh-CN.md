# GEA Interaction Request M0 契约对齐回函

> 日期：2026-08-18
> 状态：供 GEA 与 AionCore/AionUi 双方确认；未确认项不视为冻结结论
> 范围：Interaction Request V1 的 `question`、`permission`，不包含 approval V2

## 1. 背景与结论

感谢 GEA 提供《Interaction Request 契约对齐清单》。AionCore/AionUi 已结合当前代码和客户端接口文档完成复核。

双方在权威边界、四要素 Session 校验、完整 pending 快照、幂等、版本、状态机和禁止未知写自动重试等核心语义上基本一致。当前阻塞 M2 的主要问题不是业务语义，而是 HTTP 路径、错误外壳和少数字段责任尚未冻结。

建议 M0 按以下结论收敛：

1. 路径以 GEA 已实现基线为目标：
   - 创建：`POST /ai/gateway/interaction-requests`
   - 同步：`GET /ai/gateway/interaction-requests`
   - 动作：`POST /ai/gateway/interaction-requests/{requestId}/actions`
2. 普通错误统一使用顶层 `success/code/message/category` 外壳；`code` 和 `category` 必须返回给调用方，不能只写服务端日志。
3. `conflict`、`expired`、`forbidden`、`unknown_external_write` 是动作的权威业务回执状态，建议使用 `success=true + result.status` 返回；身份失效、Session 拒绝、格式错误等才使用 `success=false` 错误外壳。
4. `unknown_external_write` 必须进入 `verification_required`，禁止客户端和服务端自动重试来源系统写入。
5. M0 只冻结 `question` 和 `permission`。AionUi 虽然已有 `approval` 展示枚举，但 AionCore 的 GEA 上游模型当前只接受前两种，GEA 在 approval V2 冻结前不得下发 `approval`。

以上第 1～4 项为**建议冻结项**，需双方回复确认后才成为最终契约。

## 2. 推荐冻结的 HTTP 契约

### 2.1 接口路径

| 能力 | 建议冻结                                                    | 当前 GEA 基线                                     | 当前 AionCore                                                       | 收敛动作                                                       |
| ---- | ----------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| 创建 | `POST /ai/gateway/interaction-requests`                     | 已实现                                            | AionCore/AionUi 不调用                                              | GEA 确认创建鉴权和 ID 归属                                     |
| 同步 | `GET /ai/gateway/interaction-requests`                      | 已实现；四要素在 Query，`status` 缺省为 `pending` | `POST /ai/gateway/interaction-requests/list`，四要素在 Body         | 路径改为 GET；`delegationToken` 的安全承载位置按下文 P0 项冻结 |
| 动作 | `POST /ai/gateway/interaction-requests/{requestId}/actions` | 已实现                                            | `POST /ai/gateway/interaction-requests/action`，`requestId` 在 Body | AionCore 改为路径参数；双方确认 Body 是否仍保留 `requestId`    |

同步接口的 `agentCode`、`sessionId`、`conversationId`、`delegationToken` 必填，`status=pending`。客户端不得提交 `userId`、`tenantId`、角色或部门作为业务身份依据。

由于 `delegationToken` 被放在 Query 中，GEA 必须确认网关、反向代理、APM、访问日志和错误页均对该参数脱敏或不记录。若现有链路无法保证，双方应在 M0 将该字段改到不会进入 URL 的受保护请求位置；这一点是安全验收条件，不改变四要素校验语义。

动作接口建议以路径中的 `requestId` 为权威值。若为兼容 GEA 当前实现，Body 暂时仍要求 `requestId`，GEA 必须校验两处完全相同；双方确认后应在契约中明确，不允许静默选择其中一个。

### 2.2 成功响应外壳

快照和动作回执统一使用：

```json
{
  "success": true,
  "result": {}
}
```

同步 `result` 至少包含：

```json
{
  "revision": "gea-pending-17",
  "items": []
}
```

动作 `result` 至少包含：

```json
{
  "receiptId": "receipt-fixture-01",
  "requestId": "ir-fixture-question-01",
  "version": "v2",
  "status": "accepted"
}
```

### 2.3 错误外壳

建议冻结为顶层字段，不采用仅在日志中记录机器码的方式：

```json
{
  "success": false,
  "code": "AI_GATEWAY_INTERACTION_INVALID",
  "message": "请求字段无效",
  "category": "VALIDATION",
  "retryable": false
}
```

可选诊断字段为 `requestId`、`traceId`、`auditId`、`retryAfterMs`、`details`；必须脱敏，且不得返回凭证、Session 密钥或完整业务附件。客户端只按 `code/category` 分流，不解析 `message` 文案。

建议冻结的错误分类如下：

| code                                      |       HTTP | category         | 使用边界                                                              |
| ----------------------------------------- | ---------: | ---------------- | --------------------------------------------------------------------- |
| `GEA_LOGIN_REQUIRED`                      |        401 | `AUTHENTICATION` | 登录态缺失或失效                                                      |
| `GEA_GATEWAY_SESSION_REJECTED`            | 403 或 410 | `SESSION`        | Gateway Session 或 delegation 校验失败；GEA 需冻结 403/410 的精确条件 |
| `AI_GATEWAY_INTERACTION_INVALID`          |        400 | `VALIDATION`     | 缺字段、格式错误、非法 payload                                        |
| `AI_GATEWAY_INTERACTION_VERSION_CONFLICT` |        409 | `CONFLICT`       | 非动作回执场景的版本冲突；动作提交优先返回 `result.status=conflict`   |
| `AI_GATEWAY_INTERACTION_EXPIRED`          |        410 | `VALIDATION`     | 非动作回执场景的过期；动作提交优先返回 `result.status=expired`        |
| `AI_GATEWAY_INTERACTION_ACTION_FORBIDDEN` |        403 | `AUTHORIZATION`  | 非动作回执场景的动作拒绝；动作提交优先返回 `result.status=forbidden`  |

以下两项不建议作为 `success=false` 错误：

- 创建幂等重放：返回 `success=true`，`result.created=false`，并返回首次创建的同一 `requestId/version`。如需保留 `AI_GATEWAY_INTERACTION_ALREADY_EXISTS`，建议作为 `result.outcome`，不要让客户端走错误恢复分支。
- 外部写入结果未知：返回 `success=true`，`result.status=unknown_external_write` 和稳定 `receiptId`。如需保留 `AI_GATEWAY_INTERACTION_UNKNOWN_EXTERNAL_WRITE`，建议作为回执附加机器码，不替代回执状态。

原因是当前 AionCore 和 AionUi 都把动作结果建模为权威回执，并对精确的 `request + version + action` 缓存所有终态。若改成普通错误，客户端无法安全判断是否已发生外部写入。

## 3. 已对齐项

以下项目可直接进入 M0 契约正文：

- **权威边界**：GEA 维护创建、版本、状态、有效期、允许动作、回执和审计；AionCore 保存可恢复投影；AionUi 不维护第二套审批状态。
- **Session 绑定**：同步和动作都携带 `agentCode/sessionId/conversationId/delegationToken` 四要素，由 GEA 校验当前登录用户和 Gateway Session。
- **完整快照**：同步返回完整 pending 集合，不是增量；空集合也返回有效 `revision`；相同权威快照应保持相同 revision，内容或版本变化时 revision 必须变化。
- **请求类型**：M0 支持 `question`、`permission`；pending 快照只能包含 `status=pending`。
- **动作幂等**：客户端按 `requestId + expectedVersion + actionId` 生成稳定幂等键；同一决定的网络重试不得换新键；GEA 返回相同 `receiptId`，来源系统最多写入一次。
- **版本门禁**：`expectedVersion` 与当前版本不一致时不得执行来源系统写入。
- **允许动作门禁**：`actionId` 必须来自服务端当前版本的 `allowedActions`；permission 的每个 `option.value` 也必须属于该集合。
- **状态机**：请求状态为 `pending → resolved/expired/cancelled/verification_required`；动作回执状态为 `accepted/already_resolved/conflict/expired/forbidden/unknown_external_write`。
- **未知外部写**：`unknown_external_write` 进入 `verification_required`，在人工核验完成前不再次调用来源系统，也不得报告成功。
- **数据校验**：标识符为 1～240 个字符的非空字符串；时间为带时区的 RFC 3339；pending 快照不得包含重复 request ID。
- **展示约束**：question 必须有非空问题和选项，并允许 `answer/decline`；permission 选项必须与 `allowedActions` 一致。
- **敏感信息边界**：快照、回执和日志均不得包含凭证、Cookie、密码、密钥或完整敏感 payload。

## 4. 当前实现与双方工作

### 4.1 GEA 侧

1. 确认第 2 节三条路径为部署环境的实际路径，并提供无需真实凭证的契约测试方式。
2. 将机器码和类别返回到 HTTP 响应顶层；不能只存在服务端日志。
3. 对动作业务结果返回完整权威回执，特别是 `conflict/expired/forbidden/unknown_external_write`。
4. 对 `conflict/expired/forbidden` 尽量在回执 `request` 字段附带最新完整请求；不附带时 AionCore 会重新同步快照。
5. 对 question 的 `answer` 校验完整 `answers`，对 permission 通过受控执行器落实 production-write 门禁。
6. 提供 `unknown_external_write` 的人工核验接口、责任方、时限、审计结果和最终状态转换说明。
7. 证明 Query 中 `delegationToken` 不进入任何日志或观测系统；无法证明时，与 AionCore 一起调整承载位置。

### 4.2 AionCore/AionUi 侧

1. 将同步调用从当前 POST `/list` 改为冻结后的 GET 路径；`delegationToken` 仅按双方通过安全验收的承载方式发送。
2. 将动作调用从当前 POST `/action` 改为带 `requestId` 的复数 `/actions` 路径。
3. 保持现有稳定幂等键、并发合并、权威回执持久化和失败后重新同步机制。
4. 补充 question `answers` 完整性校验。当前 AionUi 的问答提交路径会构造完整 `answers`，但 AionCore 只校验 `payload` 是 JSON object，AionUi 的共享动作 schema 也允许任意 object，尚不能宣称所有入口都已强制落实。
5. 对顶层 `code/category` 增加 Interaction Request 专项分流测试，特别是登录态失效、Session 拒绝、版本冲突和不可重试上游错误。
6. 保持现有 Aionrs 恢复门禁：`accepted/already_resolved` 只有携带 `turnContinuation=original_tool_call_released` 才能把原工具调用视为已释放；补齐该路径的跨仓契约测试。字段在通用数据模型中保持可选，是为了兼容非 Aionrs 恢复路径，不代表 Aionrs 可以省略。
7. approval V2 冻结前，AionUi 不应向 GEA 提交或期待 `kind=approval`。

## 5. 待双方确认

以下问题应逐项给出“结论 + 责任人 + 完成日期”，缺任一 P0 项不进入 M2：

| 优先级 | 问题                                  | 推荐结论                                                                                                                                                    |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0     | 三条 HTTP 路径、方法和参数位置        | 采用第 2.1 节路径；AionCore 修改调用                                                                                                                        |
| P0     | 动作业务终态使用回执还是错误          | 使用 `success=true + result.status`；错误外壳只处理协议、身份和系统失败                                                                                     |
| P0     | 错误外壳是否返回顶层机器码            | 冻结 `success/code/message/category`，`code/category` 必须可机器读取                                                                                        |
| P0     | `unknown_external_write` 人工核验机制 | 明确核验接口、入口、责任方、时限、审计与最终状态转换                                                                                                        |
| P0     | permission 受控执行边界               | 接入 GEA 受控执行器和 production-write 门禁，禁止 Controller 直接绕过                                                                                       |
| P0     | Query 中 delegation 凭证的泄漏防护    | 给出全链路不落日志证明，否则调整参数承载位置                                                                                                                |
| P0     | 原 Turn 恢复证明                      | 冻结 `accepted/already_resolved` 对 Aionrs 必须返回 `turnContinuation=original_tool_call_released`；AionCore 当前已在恢复边界强制校验，双方补齐跨仓契约测试 |
| P1     | 创建 `requestId` 的生成方             | 推荐由 GEA 首次创建时生成；调用方只提供稳定 `idempotencyKey`                                                                                                |
| P1     | 创建接口调用身份                      | 仅 GEA 内部受信业务身份可调用，不开放给 AionUi 或普通客户端                                                                                                 |
| P1     | 动作 Body 是否重复 `requestId`        | 推荐路径 ID 为权威；若暂时重复则必须严格相等                                                                                                                |
| P1     | 创建幂等重放表示                      | 推荐 `success=true/result.created=false`，不作为错误                                                                                                        |
| P1     | Session 拒绝的 HTTP 状态              | 明确 403 与 410 的使用条件；两者都必须返回 `category=SESSION`                                                                                               |
| P1     | 过期清理与变更通知                    | 冻结过期扫描频率、revision 变化和同步可见性                                                                                                                 |
| P2     | approval V2                           | 另行冻结，不进入本轮 M0/M2                                                                                                                                  |

## 6. 共享 Fixture

Fixture 只保存业务结构，不保存任何登录态、Session 凭证或 delegation 值；四要素由联调工具在运行时注入。双方应把同一份输入和期望输出分别纳入契约测试。

### 6.1 Question Fixture

请求：

```json
{
  "id": "ir-fixture-question-01",
  "version": "v1",
  "status": "pending",
  "kind": "question",
  "title": "请选择成本中心",
  "summary": "测试付款申请缺少成本中心",
  "sourceLabel": "Fixture ERP",
  "allowedActions": ["answer", "decline"],
  "expiresAt": "2030-01-01T18:00:00+08:00",
  "updatedAt": "2030-01-01T10:00:00+08:00",
  "presentation": {
    "type": "question",
    "questions": [
      {
        "header": "成本中心",
        "question": "本次付款应归属哪个成本中心？",
        "multiSelect": false,
        "options": [
          { "label": "CC-100", "description": "测试选项一" },
          { "label": "CC-200", "description": "测试选项二" }
        ]
      }
    ]
  }
}
```

动作业务字段：

```json
{
  "requestId": "ir-fixture-question-01",
  "expectedVersion": "v1",
  "idempotencyKey": "interaction:ir-fixture-question-01:v1:answer",
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

### 6.2 Permission Fixture

请求：

```json
{
  "id": "ir-fixture-permission-01",
  "version": "v1",
  "status": "pending",
  "kind": "permission",
  "title": "确认执行测试写入",
  "summary": "只允许执行一次 Fixture 写入",
  "sourceLabel": "Fixture OA",
  "allowedActions": ["proceed_once", "reject_once"],
  "updatedAt": "2030-01-01T10:00:00+08:00",
  "presentation": {
    "type": "permission",
    "title": "确认执行测试写入",
    "description": "向隔离的 Fixture 目标执行一次可计数写入。",
    "operation": "execute",
    "detail": "FIXTURE-ONLY",
    "options": [
      { "label": "允许一次", "value": "proceed_once" },
      { "label": "拒绝", "value": "reject_once" }
    ]
  }
}
```

动作业务字段：

```json
{
  "requestId": "ir-fixture-permission-01",
  "expectedVersion": "v1",
  "idempotencyKey": "interaction:ir-fixture-permission-01:v1:proceed_once",
  "actionId": "proceed_once"
}
```

Fixture 的来源系统必须是隔离的可计数 Stub，以便证明并发或重放只产生一次写入。不得连接真实生产系统。

## 7. M2 联调验收

双方使用第 6 节同一组 Fixture，按以下顺序验收；每项都要保存脱敏的请求摘要、HTTP 状态、机器码或回执状态、写入计数和最终快照 revision。

1. **路径可达**：三条冻结路径不存在 404；AionCore 不再调用旧 `/list`、`/action`。
2. **Session 校验**：四要素正确时可同步；缺失或失效时返回稳定 `code/category`，AionCore 能区分登录失效与 Session 拒绝。
3. **完整快照**：空列表有 revision；新增、修改、解决、过期和取消会改变 revision，并从 pending 快照正确增删。
4. **创建幂等**：相同 idempotencyKey、相同内容返回同一 request ID 和版本；同键不同内容不覆盖原请求。
5. **Question 完整答案**：完整 answers 可接受；缺答案、重复问题、未知选项和多选规则不匹配均被稳定拒绝且不改变状态。
6. **Permission 受控执行**：合法 `proceed_once` 只调用一次隔离 Stub；非法 action、旧版本、过期或无权场景写入计数均为 0。
7. **动作幂等与并发**：同一 `request + version + action` 串行重放和并发提交均返回同一权威结果、同一 receipt ID，Stub 写入计数为 1。
8. **冲突对账**：`conflict/expired/forbidden` 返回权威回执；有内嵌 request 时直接更新，无内嵌 request 时 AionCore 重新同步并锁住旧卡片。
9. **未知外部写**：返回 `unknown_external_write` 后请求进入 `verification_required`；重复点击、重连和后台轮询都不触发第二次写入；人工核验可形成审计闭环。
10. **原 Turn 恢复**：按第 5 节冻结结论验证 `accepted/already_resolved` 只恢复原会话同一个 Turn 一次；恢复结果未知时不自动重投动作或消息。
11. **错误分流**：逐个验证 AUTHENTICATION、SESSION、VALIDATION、AUTHORIZATION、CONFLICT、UPSTREAM；客户端不依赖 message 文案。
12. **敏感信息检查**：URL、响应、持久化投影、日志和验收材料均无凭证或敏感业务内容。

全部通过后，双方共同记录冻结版本、部署版本、Fixture 版本和验收日期，再进入真实测试租户闭环。

## 8. 本次复核依据

以下为 AionCore/AionUi 本地复核定位，便于双方在冻结会议中追溯；它们描述的是复核时点的**当前实现**，不替代最终契约：

- GEA 清单声明路径分叉、四要素、错误码与状态机：《GEA Interaction Request 契约对齐清单（M0 冻结）》第 2～7 节。
- 现有客户端接口文档仍记录旧同步和动作路径：`docs/integrations/gea-interaction-request-api.zh-CN.md:94-159`。
- AionCore 当前同步为 POST `/interaction-requests/list`：`crates/aionui-gea/src/service.rs:530-548`。
- AionCore 当前动作为 POST `/interaction-requests/action`，并在 Body 放入 requestId：`crates/aionui-gea/src/service.rs:957-983`。
- AionCore 当前四要素 Body：`crates/aionui-gea/src/service.rs:1153-1161`。
- AionCore 已能读取顶层 `code/message/category` 和可选诊断字段：`crates/aionui-gea/src/service.rs:1181-1186`、`:1233-1274`。
- AionCore 当前快照、request 和 receipt 的严格结构校验：`crates/aionui-gea/src/interaction_request.rs:31-127`。
- AionCore 当前动作 payload 只校验为 JSON object，未校验完整 answers：`crates/aionui-gea/src/interaction_request.rs:11-28`。
- AionCore 上游类型目前只支持 question/permission；回执支持六种状态，turnContinuation 在通用模型中是可选字段：`crates/aionui-api-types/src/gea.rs:213-228`、`:298-341`。
- AionCore 将 unknown external write 投影为 verification required：`crates/aionui-gea/src/service.rs:772-787`。
- AionCore 对 accepted/already_resolved 执行持久化恢复门禁：`crates/aionui-gea/src/service.rs:843-899`；Aionrs 恢复明确要求 `original_tool_call_released`：`crates/aionui-conversation/src/service.rs:395-451`。
- AionUi 当前按 `requestId:expectedVersion:actionId` 生成稳定键，并缓存所有权威回执终态：`packages/desktop/src/common/adapter/interaction-request/actions.ts:43-71`。
- AionUi 当前允许 approval、允许任意 object payload，并定义六种动作回执状态：`packages/desktop/src/common/types/interactionRequest.ts:6-48`。

## 9. 请 GEA 回复确认

请在本回函第 5 节表格逐项补充确认结论、责任人和预计完成日期。AionCore/AionUi 收到 P0 冻结结论后，将按同一契约修改路径、补齐专项校验和契约测试，并与 GEA 使用同一组 Fixture 进入 M2。
