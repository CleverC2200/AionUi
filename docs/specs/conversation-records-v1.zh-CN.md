# 会话结构化工作记录契约 V1

## 目标与事实源

AionCore 记录会话实际使用的来源、过程输出、交付版本、外部业务结果、验证证据和完成回执。AionUi 只投影这些事实并复用现有 Preview；不得根据模型文案或工具名称判断生产动作是否完成。

可执行事实源：

- `packages/desktop/src/common/types/conversationRecord.ts`
- `packages/desktop/src/common/adapter/conversationRecords/projection.ts`

## 记录类型

- `context_evidence`：输入来源和证据。
- `output`：过程输出，不自动等同于交付物。
- `deliverable_revision`：带稳定 deliverable ID、revision、状态和替换链的交付版本。
- `external_result`：外部系统成功、失败或结果未知；未知不得被推断为成功。
- `verification_evidence`：独立校验的 pass、fail 或 inconclusive 结果及证据引用。
- `completion_receipt`：完成定义、责任主体、状态和至少一条证据引用。模型文本不能单独生成有效完成回执。

所有记录都携带稳定 ID、revision、producer、conversation、可选 Turn/Task 和时间，不得携带 secret。

## AionCore 接口与收敛

```text
GET /api/conversations/{conversation_id}/records
WS  conversation.record
```

GET 返回完整快照及单调 `revision`。事件使用连续 `sequence`：重复事件忽略；严格连续事件按记录 revision 幂等 upsert；发现 gap 时停止应用增量并重新读取完整快照。乱序事件不得覆盖较新的记录 revision。

## 客户端兼容

新会话优先使用结构化记录。文件、URL、图片和表格继续走已有 Preview 与安全打开路径。后端没有 records 能力的旧历史可暂时使用现有消息扫描兼容投影，但界面必须显示“从历史推断”，且推断结果不得生成外部成功或完成回执。

Team 聚合只引用成员原始 record ID；成员 producer、Turn/Task 归属和 deliverable 版本链不得丢失。
