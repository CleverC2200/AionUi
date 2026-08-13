# GEAUi

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要用户是通过企业 Agent 完成真实工作的业务人员。他们需要选择 Assistant 或 Team，发起工作、观察执行、处理人工介入、恢复工作并检查交付，但不应被要求理解 Agent、MCP 或 Skill 等技术实现。

GEA 管理员在平台侧配置企业 Assistant Template、能力和权限，不是当前客户端主旅程的主要用户。

## Product Purpose

GEAUi 是基于官方 AionUi 增强的企业 Agent 客户端。它让用户在持续的 Conversation 工作空间中安全使用企业受管 Assistant 与 Team，并完成从能力准备到结果交付的连续工作。

成功意味着用户无需在多个功能中心之间搬运上下文，即可清楚知道当前使用的企业能力、工作进度、需要自己处理的事项以及最终交付结果。

## Positioning

GEAUi 不以增加独立管理模块为目标，而是在官方 AionUi 的现有客户端旅程中接入 GEA 管理的企业 Assistant、Agent、Skill、MCP 和策略。企业基座保持受管，用户可以在策略允许的范围内增加个人辅助能力。

## Operating Context

- 用户从企业助手或 Team 发起 Conversation，并在同一工作空间中持续推进工作。
- 部分企业 Assistant 会通过受管 MCP 操作真实生产业务系统。
- GEA 发布 Assistant Template、版本、分配和企业策略；AionCore 或现有 Adapter 负责客户端所需的同步与投影。
- 用户可以为 Managed Assistant 增加策略允许的 Assistant Extension，但不能修改企业基座或继承额外企业权限。
- 客户端需要覆盖离线快照、能力缺失、认证、暂停、撤回和企业策略拒绝等状态。

## Capabilities and Constraints

- Conversation 是持续工作空间；Turn 是一次请求对应的执行过程。
- Assistant、Team、Scheduled Task、Attention、Output、Deliverable 和 Completion Receipt 保持各自领域边界。
- 客户端负责交互、状态展示和错误恢复入口；GEA、AionCore及目标业务系统持有真实权限与业务状态。
- 企业 Assistant Template 和依赖使用稳定身份、不可变版本及内容摘要。
- 用户扩展与企业基座分开保存，不能替换、关闭或修改企业配置。
- 所有产品和工程判断以官方 `iOfficeAI/AionUi` 的 `upstream/main` 为实现基线，并持续保持低冲突合并边界。
- 用户可见文本使用 i18n；界面复用官方组件、语义 Token 和响应式 Web/Electron 交互。

## Brand Commitments

保留 GEAUi 名称与现有品牌资产，同时沿用官方 AionUi 的界面语言、主导航、组件体系和交互习惯。本轮升级是现有产品的结构增强，不是视觉重品牌。

## Evidence on Hand

- 官方 Assistant 列表、官方助手卡片和创建助手编辑器已存在于当前代码库。
- 当前会话布局已包含主侧栏、中央 Conversation 和可折叠右侧工作区。
- `CONTEXT.md` 记录了已确认的统一领域语言。
- Wayfinder 地图及其决策票记录了 GEA 企业助手目录、同步和用户扩展规则。
- 当前没有可作为真实 GEA 服务端响应的接口或生产数据；原型必须使用明确标注的 Fixture，不能伪造生产可用性。

## Product Principles

- 增强主旅程，不堆叠独立功能中心。
- 让业务状态先于技术细节，技术信息按需展开。
- 企业能力受管，个人扩展保持可辨认、可撤销。
- 对权限、同步和错误状态保持诚实，不用缓存或本地配置冒充企业授权。
- 优先复用官方结构与交互，所有增量都为未来合并上游留出清晰边界。
