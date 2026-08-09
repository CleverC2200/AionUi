# AionUi

AionUi 是面向人的 Agent 协作工作区，用于协调 Agent、检查工作成果，并在工作需要人工处理时介入。AionCore 持有 AionUi 投影和控制的持久协作状态。

## 领域语言

**Team Work（团队工作）**：
一个 Team 的 Task、Task Run、依赖、Attention 和 Receipt 的持久集合。
_避免使用_：Board state、chat state

**Task（任务）**：
可跨重试、Agent 重启和人工介入保持同一身份的持久业务结果。
_避免使用_：Turn、prompt、job、Task Run

**Task Run（任务尝试）**：
一个 Agent slot 对某个 Task 的一次执行尝试。
_避免使用_：Task、Team Run、retry

**Team Run（团队运行）**：
由一次用户操作或系统生命周期操作发起，跨 Team 成员协调工作的运行信封。
_避免使用_：Task Run、session

**Lease（租约）**：
允许一个 Agent slot 执行某个 Task 的限时独占声明。
_避免使用_：Ownership、lock

**Attention（待处理）**：
下一步动作属于人工或 Reviewer 的 Task 状态。
_避免使用_：Notification、failure

**Completion Receipt（完成回执）**：
提交人工审查的结构化摘要、产物、验证结果和剩余风险。
_避免使用_：Final answer、activity log

**Snapshot（快照）**：
位于一个 Ordered Event 序号上的权威 Team Work 投影。
_避免使用_：Cache、local state

**Ordered Event（有序事件）**：
带有单调递增位置、用于推进或校准 Snapshot 的持久 Team Work 变更。
_避免使用_：UI event、activity row

**Member Health（成员健康）**：
Agent runtime 是否可达并具备工作能力。
_避免使用_：Member Work State、Task status

**Member Work State（成员工作状态）**：
Team 成员当前是 idle、queued、starting、running、paused 还是受约束。
_避免使用_：Member Health、Task status
