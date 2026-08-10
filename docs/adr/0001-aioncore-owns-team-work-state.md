---
status: accepted
---

# AionCore 持有 Team Work 状态

AionCore 是 Task、Task Run、Lease、Completion Receipt、命令幂等性和 Ordered Event 状态的唯一权威来源。AionUi 通过现有 HTTP/WebSocket Adapter 读取 Snapshot 和事件并提交带版本的命令；Agent 工具调用同一个 AionCore 状态机。Renderer 本地或 Agent 本地均不得形成第二套任务权威，否则无法在并发 Agent 和重启场景中保证原子认领、恢复和审计。

## 影响

- AionUi 可以显示命令正在处理，但在 AionCore 返回回执前不得提交最终状态变更。
- 外部 runtime 必须把工作映射到该 Team Work 模型，不得引入第二套 Team 状态权威。
