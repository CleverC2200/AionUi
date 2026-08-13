# Team Work 会话工作区规则

## 产品主线

Team 默认进入当前成员的会话，不再默认铺开多列或进入控制台。标题下的成员轨道是全局协作概览：负责人、成员、运行状态、当前关注点和待处理数量都来自 AionCore 权威快照；点击成员只切换当前会话上下文。

并行视图用于按需对照成员对话，Board/Activity 用于只读诊断和深入检查，均不成为第二套默认任务入口。单 Agent 会话不加载 Team Work，也不显示成员轨道。

## 状态与恢复

- Task/Run/Lease/Receipt/Event、`teamTypes`、`ipcBridge.team` 和 `teamWorkProjection` 继续是唯一 Team Work 契约。
- 成员轨道通过 `summarizeTeamMembers` 把 snapshot 压缩为 attention、blocked、stale、working、review、waiting、done；不自行修改任务状态。
- 事件重复按既有 projection 忽略，gap、失序或较旧 task version 回到 AionCore snapshot。
- lease 过期显示暂停；人工恢复继续调用 AionCore 命令，由服务端续租并重新检查团队、Agent、Profile 与工作区容量。

## 统一交互与交付

Team 请求使用同一 `InteractionRequest`。请求携带 `team_id + slot_id + conversation_id + turn_id/message_id` 时，顶层待处理入口回到 Team 的原成员与原消息，继续原 Turn。

成员产物使用同一 Conversation Record 协议。当前成员即当前筛选；切换成员后检查器读取该成员会话的来源、输出、交付版本和回执。Team 聚合视图只能引用成员原始 record ID，不得复制后丢失 producer、Turn/Task 或版本链。

窄屏始终使用单成员主视图；成员轨道可横向滚动，检查器仍是按需 Popover，不遮挡发送区。
