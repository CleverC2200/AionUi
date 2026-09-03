# 统一 Agent 体验验收矩阵

## 核心旅程

正式产品只保留一条主旅程：打开客户端 → 同步企业助手/Skill/MCP → 助手详情/本地辅助能力 → 会话准备 → 会话运行 → 业务系统待处理 → 恢复原 Turn → 结构化交付 → 完成回执。Team 复用同一旅程，只增加成员上下文，不另建任务与交付状态源。完整业务时序见 `gea-enterprise-business-lifecycle-v1.zh-CN.md`。

## 侧栏与专项 Agent 导航契约

- 产品顶层只保留通用版和业务版：通用版继续使用现有会话历史侧栏；业务版在同一侧栏区域复用 `AssistantSurfaceNavigation`，不另建并行应用壳层。
- 业务版左侧使用可展开的业务分类，分类下的叶子菜单直接对应 Agent；切换叶子菜单必须同步切换中间业务看板、右侧 Conversation 绑定和 `SurfaceContextSnapshot`。分类仅用于组织 Agent，不拥有独立业务状态。
- 可用 Agent、顺序、图标和角标由 `packages/desktop/src/renderer/pages/assistantSurface/registry.ts` 的 `businessMenu` 元数据定义。新增 Agent 只注册一个新的业务 Surface，不复制侧栏、三栏布局或 Conversation 运行链路。
- 业务版采用已确认的 A“任务航线”模板：左侧可展开 Agent 导航、中间业务看板、右侧真实 Conversation，并在数据画布上方显示由当前 Agent 提供的阶段步骤。
- 需求预测和合同审查分别将当前筛选、选区、指标和本地变更写入发送时冻结的 `SurfaceContextSnapshot`；后续看板变化只标记为下一轮待同步。
- 导航使用 Arco 菜单与 AionUi 语义 Token；业务版统一使用 GEA 红色选中态，Agent 自身颜色只用于身份图标和业务语义状态。

## 自动化证据

| 风险                                | 预期行为                                                                                                                                                                          | 自动化证据                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 目录首次失败、空目录                | 在原位置显示错误或空状态，不伪造企业助手                                                                                                                                          | `assistantCatalog.test.ts`、`OfficialAssistantsGrid.dom.test.tsx`                                      |
| 离线 last-good、陈旧 revision       | 明示上次同步版本和“待同步”，允许就地重试；新会话仍由 AionCore 决定能否开始                                                                                                        | `assistantCatalog.test.ts`、`useAssistantList.dom.test.ts`、`OfficialAssistantsGrid.dom.test.tsx`      |
| 暂停、撤回、客户端过低              | 禁止启用或开始，准备错误提供 Skill、MCP 或更新入口                                                                                                                                | `OfficialAssistantsGrid.dom.test.tsx`、`conversationPreparation.test.ts`、`useGuidSend.dom.test.ts`    |
| 扩展冲突、MCP 未授权、身份/策略变化 | 保留本地草稿，在字段旁显示服务端拒绝；不创建半配置会话                                                                                                                            | `managedAssistantExtensions.test.ts`、`AssistantEditorPage.dom.test.tsx`、`useGuidSend.dom.test.ts`    |
| 准备取消、准备竞态                  | 取消立即返回；晚到结果不可创建会话；只消费最新 generation                                                                                                                         | `conversationPreparation.test.ts`、`useGuidSend.dom.test.ts`                                           |
| 请求过期、无权限、版本冲突          | 原消息内显示权威状态变化，不静默吞错                                                                                                                                              | `PermissionMessages.dom.test.tsx`；结构化问题卡同分支人工复核                                          |
| 重复提交、重连、未知外部写入        | 合并重复提交；未知结果先核验且不自动重试                                                                                                                                          | `interactionRequestActions.test.ts`、`AttentionInbox.dom.test.tsx`                                     |
| 结构化事件重复、乱序、gap           | 较旧 revision 不覆盖新记录；gap 回源权威 snapshot                                                                                                                                 | `conversationRecords.test.ts`、`teamWorkProjection.test.ts`                                            |
| 交付替换、证据缺失                  | 按稳定 record ID/revision 替换；无证据不得宣称完成                                                                                                                                | `conversationRecords.test.ts`、`ConversationResources.dom.test.tsx`                                    |
| Team lease 过期与待处理恢复         | 成员显示暂停而非运行；待处理回到原成员、原消息                                                                                                                                    | `memberWorkSummary.test.ts`、`AttentionInbox.dom.test.tsx`                                             |
| GEA 资源到企业业务任务闭环          | 三类资源逐页同步后才允许受管 prepare；左栏项目任务按 AionCore runtime 展示“进行中 / 待处理 / 已完成”；ERP question、OA permission 均回到原 Turn；生产结果经有效证据链形成完成回执 | `enterprise-business-lifecycle.e2e.ts`、`ConversationRowCronMenu.dom.test.tsx`                         |
| 键盘与焦点                          | 目录卡片可用 Enter/Space；抽屉关闭恢复触发器；请求跳转聚焦原消息内首个操作                                                                                                        | `OfficialAssistantsGrid.dom.test.tsx`、`AttentionInbox.dom.test.tsx`、`focusMessageTarget.dom.test.ts` |

## E2E 视口矩阵

最终 E2E 使用同一核心用例在标准 AionUi 与 GEAUi 品牌配置下运行。Agent Surface 本轮只验收桌面端，不验收移动端；至少截图并检查以下环境：

- 桌面宽窗：1440×900。
- 桌面标准窗：1124×720。
- 桌面窄窗：900×900。
- 高缩放等效窄窗：450×900，作为 200% 缩放恢复性检查，不作为移动端布局。

通过条件：无水平页面溢出；发送区、准备取消、错误恢复和待处理主操作可见；企业状态不只依赖颜色；Tab 顺序可达目录、筛选、卡片、启用、对话和更多操作；焦点环清晰且关闭浮层后返回原触发器。

## 人工证据边界

生产业务 MCP、企业身份切换和 GEA 服务端策略错误只能在具备企业测试租户时做真实 E2E。无租户环境使用 AionCore 契约 fixture 验证客户端分支，不伪造“已提交生产”的回执。任何外部写入结果未知时，验收必须停在“需要核验”，不得点击自动重试。
