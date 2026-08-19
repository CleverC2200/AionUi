# GEA Interaction Request M0 推荐方案

> 日期：2026-08-19
> 用途：针对《M0 冻结回复表》中未定项给出推荐结论，供 GEA 确认
> 原则：复用现有能力，最小改动，能跑通 question/permission 流程闭环即止

## 结论总览

| #   | 未定项                      | 推荐结论                                                                                                             | 谁改                   |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | 错误码字段名                | `errorCode` 承载字符串机器码，`code` 保持 Integer 兼容；AionCore 只认 `errorCode`                                    | AionCore               |
| 2   | Session 拒绝状态码          | HTTP 保持 200，`category` 为唯一分流依据，不引入严格 403/410 语义                                                    | 双方确认，代码基本不动 |
| 3   | unknown_external_write 核验 | 复用 actions 接口，给 `verification_required` 增加 `verify_succeeded` / `verify_failed` 两个动作，不新增独立核验接口 | GEA + AionCore/AionUi  |
| 4   | permission 生产门禁         | M2 用隔离 Stub 验收流程和幂等；真实 production 门禁另立验收，不阻塞本轮                                              | 业务确认后另排期       |
| 5   | 创建鉴权 SERVICE Bearer     | V1 保持网关会话校验，暂不补 SERVICE Bearer                                                                           | 不新增                 |
| 6   | 变更通知                    | M2 用 AionCore 轮询 + revision，不做 GEA push                                                                        | 不新增                 |
| 7   | 冲突回执内嵌 request        | 不要求内嵌，客户端冲突时重新 list 同步（已实现）                                                                     | 不新增                 |

## 逐项说明

### 1. 错误码字段名：`errorCode` 为准

GEA 保留 `code` 为 Integer 兼容码，新增 `errorCode` 承载字符串机器码，例如 `AI_GATEWAY_INTERACTION_VERSION_CONFLICT`。AionCore 只读 `errorCode` 做机器分流，不再依赖 `code` 的字符串值。

这样 GEA 不用动现有 Integer 兼容逻辑，客户端只需改一处解析。`errorCode` 在 `success=false` 时必填；`category` 同样必填。

### 2. Session 拒绝：不引入 403/410 语义

GEA 已经统一 HTTP 200 + 顶层 `errorCode/category`，建议维持现状，不再把 403/410 拆成独立 HTTP 状态。客户端只按 `category` 分流：

- `AUTHENTICATION`：登录态失效，提示重新登录，清理本地 auth；
- `SESSION`：Gateway Session 失效/过期/撤销，清理本地 session，必要时重连。

两者必须严格区分，避免把"会话有效但无权"误判成"会话失效"。403/410 的 HTTP 语义不作为联调验收项。

### 3. unknown_external_write 核验：复用 actions，不新增接口

推荐把 `verification_required` 当作 pending 状态的一种延续，允许用户通过现有 actions 接口提交两个核验动作：

- `verify_succeeded`：人工确认来源系统实际写入成功，转 `resolved`；
- `verify_failed`：人工确认写入未发生或放弃，转 `cancelled`。

回执仍走现有动作回执结构，`resolved_by` 记录核验人，`resolved_at` 记录核验时间，`auditId` 保持可审计。不引入独立的"核验工作流"或新的核验端点。

这样用户能在系统内完成对账并关闭待办，而不是永远停在悬置状态。

### 4. permission 生产门禁：M2 用 Stub，生产另排

M2 只验收 permission 的流程和幂等性，用隔离 Stub 证明同一 `proceed_once` 只写一次（写入计数 = 1）。真实 production-write 门禁和受控执行器不在本轮联调，业务定稿后另立验收项。

这样不阻塞 question/permission 的流程联调，也不把未定稿的生产门禁提前塞进协议。

### 5. 创建鉴权：V1 保持网关会话校验

当前创建只由 GEA 内部受信业务调用，网关会话校验已能满足最小闭环。SERVICE Bearer 留到有真实跨服务创建需求时再补。

### 6. 变更通知：M2 用轮询

GEA 不做主动 push。AionCore 已实现 3 秒轮询 + revision 变化检测，M2 可接受。变更通知作为后续优化项，不进入本轮冻结。

### 7. 冲突回执：不内嵌完整 request

GEA 继续只回传最新 `version/requestId`，不内嵌完整 request 对象。AionCore 和 AionUi 在 `conflict/expired/forbidden` 时重新 list 同步（已实现），多一次请求可接受。

## 最小闭环路径

`question` 不涉及外部写入，不受第 3、4 项影响。双方先把第 1、2 项冻结，AionCore 按已确认路径改完（GET + `X-Delegation-Token` Header、`/actions` 路径参数），question 闭环即可先走通。

`permission` 的流程和幂等用隔离 Stub 走通，真实生产门禁等业务定稿后另排。
