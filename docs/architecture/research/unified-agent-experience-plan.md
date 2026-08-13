# GEA 统一能力市场与运行闭环规划

> 状态：下一阶段规划基线，不是实现规格。冻结时间：2026-08-11。
>
> 本文纠正此前的范围误解：Skill、MCP、Agent、知识能力的目标是建设一个与 GEA 运行时打通的统一市场，不是继续给 AionUi 增加几个资源设置页。此前 Team Work 与过程 UI 的结论仍有效，但作为独立工程轨道，不再占据本规划主线。

## 1. 结论先行

下一阶段应建设 GEA Capability Market，形成一条可证明的交付链：

供给与打包 → 校验与审核 → 发布不可变 Release → 租户授权 → 托管激活或本地安装 → 绑定 Agent Revision → 运行预检 → 真实执行 → 回执与审计 → 更新、撤回和回滚。

当前系统并非从零开始：

- AionHub 和 AionCore extension 已提供统一包格式的主要骨架，能够表达 Agent、Skill、MCP、Assistant、Channel、Theme 等贡献类型。
- GEA Gateway 已能按 agentCode 创建授权会话、动态列出和调用 MCP 工具，并返回 auditId。
- AionCore 已能冻结本地 Skill/MCP 会话快照，aionrs / ACP 能消费 Core 已解析的能力。
- 企业 Agent 平台已有 Agent、Skill、Tool Policy 的管理雏形。

真正缺少的是市场控制面与运行交付面之间的统一合同。目前保存的 skill_ids、MCP ID、市场来源和实际运行版本没有连成一条证据链；市场成功、安装成功、绑定成功和本次真的运行成功也没有被区分。

因此第一优先级不是市场首页、评分或更多卡片，而是：

1. 先冻结 Publisher、Package、Release、Entitlement、Deployment、Binding、RuntimeBundle 和 Receipt 的最小跨仓合同。
2. 完成一条包含最小发布、审核、授权、托管激活、Agent 绑定和真实调用的 GEA 托管 MCP 纵向切片，利用已有 Gateway session/list/call/auditId 缩短交付路径。
3. 第二条切片完成带签名和 digest 的 Skill Release 安装、加载、升级与回滚。
4. 两条链都稳定后，再产品化完整发布/审核中心、组织分发、Agent 模板和知识/工作流资产。

## 2. 先统一语言，避免再次做成功能堆叠

| 领域对象             | 含义                                                                                               | 权威归属                                           | 不能混同                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| Publisher            | 发布者命名空间、组织身份、签名身份和发布权限                                                       | GEA IAM / Market                                   | Publisher 不是普通页面作者字段                                        |
| MarketplaceListing   | 可搜索、可运营的商品介绍和当前公开版本指针                                                         | GEA Market                                         | Listing 不是可执行包                                                  |
| CapabilityPackage    | 发布者命名空间下的能力身份，可为 agent、skill、mcp、knowledge、workflow 或 bundle                  | GEA Market                                         | Package 不是某次安装                                                  |
| CapabilityRelease    | 不可变版本、manifest、artifact、digest、签名、兼容条件和权限声明                                   | GEA Market / Artifact Store                        | Release 不允许同版本覆盖                                              |
| Review               | 自动校验、安全扫描、维护者审核及其证据                                                             | GEA Market                                         | 审核通过不代表运行成功                                                |
| Entitlement          | tenant、org、team、user 或 agentCode 获得某项能力的授权、范围、期限和 revision                     | GEA IAM / Policy                                   | Entitlement 不是本地安装或运行许可自述                                |
| CapabilityDeployment | 精确 Release 在执行目标上的物化：GEA hosted activation 或 AionCore local installation              | 对应执行目标的服务端                               | 托管 MCP 不伪造本地 Installation                                      |
| SecretBinding        | credential requirement 到服务端 secret reference 的范围化映射                                      | GEA Secret Service；本地目标由 AionCore 安全代理   | SecretBinding 不包含明文值                                            |
| CapabilityBinding    | Entitlement、Release、Deployment 与 AgentRevision 或 TeamMemberRevision 的版本化绑定               | GEA Agent Registry；AionCore 保留本地投影          | Binding 不等于运行时已加载                                            |
| AgentRevision        | Agent 身份、提示词、模型、Tool Policy 和所有能力绑定的不可变版本                                   | GEA Agent Registry                                 | 不再只保存可变 skill_ids                                              |
| RuntimeBundle        | GEA Resolver 将 AgentRevision、Entitlement、Release、SecretRef 和 Tool Policy 解析出的逻辑运行投影 | GEA Resolver                                       | AionCore 或 LangGraph adapter 只渲染目标格式，不建立第二个逻辑 Bundle |
| OperationReceipt     | publish、review、activate/install、bind、preflight、rollback、revoke 的终态证据                    | 执行动作的服务端，使用统一 envelope                | Toast 不是 receipt                                                    |
| ExecutionReceipt     | 某次 run / tool invoke 实际使用的 release、binding、policy decision、结果和 auditId                | 对应 runtime / Gateway，归一化回 GEA receipt store | 执行成功不由模型文本证明                                              |
| Revocation           | entitlement revoke、release yank 或 emergency suspend 的决策、范围、原因和生效策略                 | GEA IAM / Market / Security                        | yank、revoke、suspend 不能合成一个删除动作                            |

这组边界会直接影响界面：

- 市场负责发现、理解、获得和治理能力。
- Agent Builder 负责把已获得的能力绑定到一个 Agent Revision。
- 运行工作区负责展示本次实际加载和调用了什么，以及发生了什么。
- Task、PersonalTodo、Attention、ProcessEvent 是运行状态，不是市场商品；市场最多分发 Workflow Template、Task Template 或受控 Interaction Component。

## 3. 证据快照与当前断点

### 3.1 Jiuwen 能提供什么

Jiuwen 不是一个完整统一市场，但有三组很值得借鉴的组件：

- SkillHub：发布、版本、系统审查、人工审核、公开稳定版本、搜索、下载、群组授权。
- JiuwenSwarm SkillNet：多市场源适配、搜索、异步安装、启停和卸载。
- Agent Studio：将市场 REST Tool 物化为本地插件、记录 original_market_plugin_id，并在失败时补偿删除。

不应照搬的部分：

- SkillHub 允许 force 覆盖同版本，缺精确安装锁、软下架和完整回滚。
- SkillNet 的安装 job 只是进程内存表，不是 durable receipt。
- MCP/REST CLI 主要完成解压，没有形成 initialize、tools/list、smoke test、原子启用和回滚闭环。
- 不同市场来源的同名 Skill 仍可能用名称去重，丢失来源身份。

详细能力证据与普通功能矩阵见：

- [Jiuwen 详细调研](./jiuwenswarm-aionui.md)
- [Jiuwen 能力与投稿矩阵](./jiuwen-capability-adoption-matrix.md)

### 3.2 Aion / GEA 已经有什么

| 现有资产                                                                             | 已有能力                                                                                              | 关键断点                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [AionHub](https://github.com/iOfficeAI/AionHub) manifest                             | semver、engine/apiVersion、dependencies、license、permissions；可贡献 Agent、Skill、MCP 等            | 当前公开仓内容仍以 ACP Adapter 为主，不是完整商品目录；静态 index 没有 GEA 租户、审核、entitlement 和撤回语义                                |
| AionCore extension / Hub                                                             | 本地包发现、manifest 解析、安装路由；本地主工作树另有远端下载、完整性校验、安全解压和原子替换候选实现 | 已提交基线的远端安装能力仍不完整；dirty worktree 候选不能当成已发布事实；缺 durable job、version lock、used-by guard 和长期 rollback         |
| GEA 登录与 Gateway                                                                   | agentCode 授权会话、delegation token、MCP list/call、auditId                                          | agentCode 没绑定市场 Entitlement、Deployment 或 AgentRevision；只有运行授权，没有市场授权                                                    |
| [GEA MCP bridge](../../../packages/web-host/src/gea-mcp-bridge.ts)                   | 把 Gateway tools 动态映射成本地 MCP                                                                   | tool call 返回时丢弃 auditId、sourceCode 和原始 toolName                                                                                     |
| Desktop GEA 服务                                                                     | 启动 loopback bridge 并注册内建 gea-gateway MCP                                                       | 共享单一 GEA_AGENT_CODE，默认 sales_forecast，不能按 Agent 或 Team 成员动态绑定                                                              |
| [Assistant 类型](../../../packages/desktop/src/common/types/agent/assistantTypes.ts) | 保存 enabled_skills、defaults.skills、defaults.mcps                                                   | 只有裸名称或 ID，没有 package、release、digest、grant 和 binding revision                                                                    |
| AionCore conversation                                                                | 将 Skill 与 MCP 冻结到会话，再由 aionrs / ACP 消费                                                    | 快照没有市场来源和精确 Release，无法证明某个获授权版本实际运行                                                                               |
| enterprise-agent-platform                                                            | Agent、Skill、Tool Policy 管理 CRUD                                                                   | SkillRecord 缺 publisher/package/release/digest/review/install/revoke；保存的 agent_skills 未进入 runtime；前端和路由仍硬编码 sales_forecast |

需要特别说明：

- 当前 AionCore 主工作树中较完整的 HubInstaller 是未提交候选实现，本规划只把它视为可复用资产，不视为生产基线。
- 当前所谓 Skills Market 开关只是添加一个占位 URL，文件扫描并不会把它变成真实市场。
- AionUi 的 AgentHubModal 目前主要过滤 ACP Adapter；不能直接扩几个 filter 就宣称有统一市场。
- 本轮可见的 AionUi、AionCore 和 enterprise-agent-platform 仓库中未发现 GEA Market 服务端实现，因此本文中的 Market API 是建议契约，不是对整个 GEA 现状的推断。

## 4. 目标架构

| 层                            | 负责                                                                                                                  | 不负责                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| GEA Market Control Plane      | publisher、listing、release、自动校验、安全扫描、人工审核、搜索、组织策略、entitlement、下架和运营                    | 修改本机运行目录、持有用户本地密钥            |
| Artifact / Delivery Plane     | 不可变 artifact、digest、签名、SBOM、短期下载票据、分发缓存                                                           | Agent 运行决策                                |
| GEA Agent Registry / Resolver | AgentRevision、CapabilityBinding、Tool Policy、Entitlement 解析、逻辑 RuntimeBundle                                   | 安装本地二进制或直接渲染 UI                   |
| GEA Gateway                   | session access decision、短期 delegation、MCP tool resolution/call、权威 auditId                                      | 商品详情、发布审核、tarball 安装              |
| AionCore                      | 本地执行目标的验签与 digest 校验、事务安装、SecretRef 代理、binding 投影、preflight、conversation snapshot 和 receipt | 市场运营、发布者审核、托管 MCP 的虚假本地安装 |
| aionrs / ACP                  | 消费已解析 Skill/MCP/Prompt 并执行                                                                                    | 市场、购买、授权和版本升级                    |
| AionUi / GEA Workbench        | 市场浏览、详情、权限确认、安装/绑定交互、运行证据和问题修复                                                           | 信任判定、明文密钥、运行时注入                |

GEA 有两条运行交付路径，但只能有一套市场与版本合同：

- GEA 原生 Workbench：GEA Resolver 把 AgentRevision 解析成 RuntimeBundle，FastAPI/LangGraph runtime 必须真实消费 Skill、MCP 和 Tool Policy binding。当前只保存 agent_skills、运行侧仍硬编码 sales_forecast 的状态必须先结束。
- AionUi Desktop：同一个 RuntimeBundle 通过 AionCore delivery adapter 落成本地 Skill/MCP，会话再交给 aionrs / ACP 执行。AionCore 是本地安装与执行权威，不是另一个市场。
- 两条路径共享 packageId、releaseId、digest、entitlementRevision、bindingRevision 和 receipt envelope；只允许 transport、deployment target 和 backend capability 等运行时字段不同。

统一主链如下：

1. 发布者提交 CapabilityPackage 和一个不可变 CapabilityRelease。
2. GEA 完成 schema、兼容、权限、安全和人工审核。
3. Listing 只把 approved release 暴露给有权限的租户。
4. 用户或管理员获得 Entitlement；托管能力由 GEA 创建 Activation，本地 artifact 由 AionCore 创建 Installation job。
5. Agent Builder 把精确 Release、Entitlement 和 Deployment 绑定到新的 AgentRevision，而不是修改正在运行的版本。
6. Start 前由 Resolver 生成 RuntimeBundle，并完成 policy、secret、health 和 compatibility preflight。
7. 会话冻结 package、release、digest、entitlementRevision、bindingRevision、agentCode 和 toolSetRevision。
8. 实际调用后保留 GEA auditId 与 AionCore runtime receipt。
9. 更新创建新 Deployment / Binding revision；旧会话仍固定旧版本。
10. yank、revoke 和 emergency suspend 使用不同策略，所有动作都有可查询收据。

## 5. 规划主表：Jiuwen 市场能力如何进入 GEA

| 市场旅程 / 对象                | Jiuwen 值得借鉴的能力                                                    | GEA 当前需要补什么                                                                                                         | 主责 / 目标组件                                                | 产品交互，不只是页面                                                                         | 保留 / 重塑 / 停止                                                                            | 优先级 | Jiuwen 官方需求、Issue / PR 状态                                                                                                                                                           | 向官方投稿概率与前提                                                 | 最小验收                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 统一包身份                     | SkillHub version、SkillNet 多源、AionHub manifest                        | source + publisher + slug + version + digest 的稳定 identity；同版本不可覆盖                                               | GEA Market shared contract                                     | 详情页明确来源、版本、digest、兼容范围；同名不同源可并列                                     | 保留 Aion extension 格式；重塑为 GEA CapabilityPackage / Release；停止按 name 去重            | P0     | [JiuwenSwarm #2659](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2659) Open major，未发现关联 PR                                                                                    | 中高；先补多源同名 fixture 和 canonical identity，不扩大到全市场重构 | 三个同名多源 Skill 可独立安装、更新和绑定；刷新后身份稳定                                                 |
| 发布与版本                     | SkillHub 的 PENDING / APPROVED / REJECTED、public_latest_version         | immutable release、digest、signature、SBOM、兼容和权限差异；待审版本不替换稳定版                                           | GEA Market / Artifact Store                                    | 发布中心按 Draft → Validate → Submit → Review → Approved 展示；失败可回到具体字段            | 保留审核状态机；停止 force 覆盖同版本                                                         | P1     | [SkillHub #49](https://github.com/openJiuwen-ai/skillhub/issues/49) Open major，要求模板和插件成为平级市场资产                                                                             | 完整功能低；Maintainer 先确认 schema 后，独立 validator/API 切片中   | 已批准 v1 持续可安装；v2 待审不影响 v1；同版本不同 digest 被拒                                            |
| 自动校验与人工审核             | SkillHub 系统审查 + 人工审核                                             | 分开安全扫描、维护者审核、运行验证和用户口碑                                                                               | GEA Market Review                                              | 审核页显示权限 diff、依赖、风险、测试证据；不合并成一个模糊分数                              | 重塑；停止用点赞或 review_count 代替安全可信度                                                | P1     | SkillHub #49 的一部分，未见独立小 Issue                                                                                                                                                    | 低到中；先提审核契约 RFC 或纯 validator，小步认领                    | 每个通过项可追到规则、执行时间和 reviewer；权限扩大必须重审                                               |
| 发现与市场源                   | SkillNet、ClawHub、SwarmSkills 的 Source Adapter                         | GEA catalog adapter、来源优先级、兼容过滤、租户可见性                                                                      | GEA Market Catalog                                             | 一个统一市场，以能力类型和兼容性筛选；来源作为标签，不建立多个“市场页”                       | 保留 adapter 模式；停止 Skill/MCP/Agent 三个互不相干的市场                                    | P2     | 暂无适合的原子 JiuwenSwarm 空缺                                                                                                                                                            | 不适用；属于 GEA 产品架构                                            | 同一搜索可返回多种资产且来源可追溯；不兼容项默认不提供安装                                                |
| 租户与组织授权                 | SkillHub 群组 pending / active / rejected / revoked                      | tenant/org/team/user/agentCode 分层 Entitlement、发布者白名单、权限预算、到期和撤回                                        | GEA IAM / Policy                                               | 激活或安装前先显示“谁能用、给哪个 Agent、需要哪些权限”；管理员审批在同一订单轨迹             | 保留授权状态机；重塑为 GEA IAM；停止把下载等同授权                                            | P0     | [SkillHub #7](https://github.com/openJiuwen-ai/skillhub/issues/7) Open，PR #21 仅部分覆盖删除通知                                                                                          | 中高；只补群组删除后的授权失效事件、通知和测试                       | 无 Entitlement 不出现在可用列表；撤回后新 session fail-closed；历史审批仍可查                             |
| 安装 Job 与错误回执            | SkillNet 异步安装、Agent Studio 失败补偿                                 | durable install job、requestId、idempotencyKey、结构化错误、安全 staging、原子激活和 rollback token                        | AionCore extension + AionUi                                    | 操作后进入可恢复进度，不只 Toast；失败给可执行修复项，刷新不丢状态                           | 保留异步交互；停止进程内 job 和“下载成功=安装成功”                                            | P0     | [JiuwenSwarm #2656](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2656) Open，未发现关联 PR                                                                                          | 高；先捕获真实 payload，再补 error envelope、UI 和测试               | transport、校验、权限、安装四类错误均有稳定 code；不泄露 secret/堆栈                                      |
| Agent / Team Template 市场     | Studio 的导入、复制和“安装为草稿”                                        | AgentBundle：模板 DSL、依赖锁、secret schema、兼容条件；安装后 fork 成 Agent draft                                         | GEA Agent Registry / Workbench                                 | 详情页先看角色、依赖和权限；“使用模板”进入 Builder 预检，不直接运行                          | 保留 copy-as-draft；停止把模板静默写成可运行 Agent                                            | P2     | [SkillHub #49](https://github.com/openJiuwen-ai/skillhub/issues/49) 明确包含智能体和团队模板                                                                                               | 完整实现低；schema 或导入 adapter 经评审后中                         | 安装模板不会修改原发布物；缺依赖时阻止发布 AgentRevision                                                  |
| Skill 市场                     | SkillHub 发布/版本/下载；SkillNet 指定来源与启停；SkillDev 测试/回退思路 | signed release、安装账本、精确版本锁、materialize、runtime load receipt、升级和回滚                                        | GEA Market + GEA/AionCore runtime adapters                     | 详情 → 权限/文件 diff → 安装 → 绑定 Agent → Build Preview → 真实运行；每步状态独立           | 保留现有 Skill loader；重塑 Skills Hub 为“已安装”；停止裸 name 绑定                           | P1     | [JiuwenSwarm #2533](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2533) Open major；指定版本和回退。[#2031](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2031) Open；本地更新 | 完整多版本低，拆分后中；显式刷新中                                   | 旧会话固定 v1；新 AgentRevision 可切 v2；失败一键回退且 runtime receipt 证明实际加载版本                  |
| GEA 托管 MCP 市场              | MCP manifest、连接/启停分离、trust、tool discovery；Studio 凭据配置思路  | Entitlement 与 agentCode 绑定、HostedActivation、ConnectionTemplate、SecretBinding、toolSetRevision、Gateway audit receipt | GEA Market/IAM + Agent Resolver + Gateway                      | 详情显示工具、数据范围和权限；获得后直接选择目标 Agent；运行中可展开实际 source/tool/auditId | 保留 GEA Gateway；重塑 gea-gateway 从全局 bridge 为按 Binding 解析；停止硬编码 sales_forecast | P0     | [JiuwenSwarm #2184](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2184) 有大型 WIP [PR #2574](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2574)                                | 低，不开平行 PR；可以 review 或补独立测试                            | 无 Entitlement 时 list 不出现工具，直接 call 被拒；tenant/agent/session 错配 fail-closed；auditId 到达 UI |
| 自托管 MCP / REST Plugin       | Agent Studio Market Adapter、original_market_plugin_id、失败补偿         | 隔离 staging、依赖安装策略、initialize、tools/list、smoke test、health、原子启用                                           | GEA Market + target runtime adapter                            | 安装向导在 secret binding 后现场验证；连接成功和可用分开显示                                 | 保留 adapter/补偿；停止 CLI 解压后即“已安装”                                                  | P2     | [Agent Studio #305](https://github.com/openJiuwen-ai/agent-studio/issues/305) Open major，插件版本回退                                                                                     | 中低；先确认 AgentArts 版本存储和运行切换契约                        | 不启动未知包进入主运行目录；smoke test 失败不激活；可回退                                                 |
| Knowledge Pack / Connector     | LLMWiki source/hash、DeepSearch citation、index fingerprint              | 数据源契约、ingestion job、immutable source、citation span、index revision；数据授权与代码包授权分离                       | GEA Knowledge/Data Services                                    | 市场安装 Connector；随后在工作区授权数据范围并预览同步状态，不能一步“接入全部数据”           | 借来源、索引与 citation；停止把知识文件直接塞进 Skill 包或默认写回                            | P2     | Jiuwen 主仓相关项多为运行正确性，不是成熟市场 Issue；详见能力矩阵 K-01 至 K-06                                                                                                             | 不适用或低；先在 GEA 建域                                            | 重复导入去重；每段回答可追到 source/span；撤权后新检索不可见                                              |
| Workflow / Task Template       | ExecutionPlan、PersonalTodo、TeamTask 三域语义                           | 市场只分发模板；运行实例仍由 GEA/AionCore 创建并持久化                                                                     | GEA Workflow runtime + AionCore Team Work                      | “使用模板”先预览将创建的计划、权限和 Agent；运行后进入原工作区，不跳到市场管理               | 保留三域边界；停止把真实 Task/Todo 作为可安装商品或复制第二套 task store                      | P2     | Todo 恢复 [#2091](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2091) 与市场只间接相关                                                                                               | 市场 PR 不适用；运行恢复修复需另行复现                               | 模板版本可追溯，但 Task/Run/Receipt 使用运行域 ID 和权威状态                                              |
| Interaction Component          | structured question、permission、fixed registry A2UI、channel fallback   | 只允许签名、版本化、固定 registry 的 UI contribution；action 仍过 policy                                                   | GEA UI Registry + runtime policy                               | 市场详情预览组件能力；运行中就地回答/审批，失败降级为文本，不让用户切页面                    | 借固定组件 registry；停止 arbitrary DOM/script 和“市场组件直接发业务请求”                     | P3     | 相关 Jiuwen 项多已有实现或活跃 PR，不建议抢占                                                                                                                                              | 低或不适用                                                           | 未注册组件和越权 action 被拒；回答、拒绝、过期均有 terminal receipt                                       |
| Agent Binding 与 Build Preview | Jiuwen 的声明/实例分离、build seed、Team scope                           | AgentRevision、CapabilityBinding、Entitlement/Release 锁、Tool Policy 和 capability diff                                   | enterprise-agent-platform Registry/Resolver + AionCore adapter | Market 负责获得；Builder 侧栏负责装配；保存前显示最终清单、冲突、secret 和权限差异           | 保留现有 Assistant 编辑；重塑为版本化 Builder；停止在多选框中保存裸 ID 后直接成功             | P0     | 属于 GEA/Aion 契约，不是 Jiuwen 原子缺陷                                                                                                                                                   | 不适用                                                               | 同一 revision 解析出稳定 RuntimeBundle；任何 missing/degraded binding 都能定位和修复                      |
| 运行与过程回执                 | Jiuwen 的 tool/subtask/final 渐进披露、结构化交互                        | ProcessEvent 关联 package/release/binding/run/auditId；final 与工具过程分离                                                | GEA Gateway/runtime + AionCore + clients                       | 对话仍是中心；Run Rail 显示本次加载能力、调用、审批和产物；点击市场能力可回看证据            | 保留对话；重塑 message type switch；停止只显示通用成功/失败 Toast                             | P0     | 安装错误 #2656 可投稿；完整 GEA receipt 不适用                                                                                                                                             | GEA 本地高价值；上游仅小错误合同高                                   | 一次真实调用能从消息追到 exact release、policy decision、GEA auditId 和终态                               |
| 更新、下架、撤回和回滚         | SkillHub entitlement revoke；多版本诉求                                  | approved / yanked / suspended 三态、used-by、影响预览、分阶段激活、旧会话策略                                              | GEA Market/IAM + target runtime                                | 更新前展示 Agent/Team 使用方和权限 diff；撤回给出新旧 session 语义；一键回滚                 | 保留 revoke ledger；停止硬 DELETE Release 和静默自动升级                                      | P1     | SkillHub #36 Open；历史群组状态修复。Jiuwen #2533 版本回退                                                                                                                                 | 数据迁移中；完整回滚拆分后中                                         | yank 禁止新装但不破坏已固定会话；suspend 按策略 fail-closed；全部动作可审计                               |
| 可信度与运营                   | SkillHub 点赞、收藏、浏览和推荐                                          | 分开安全审核、维护状态、组织采用、真实运行成功率、用户反馈                                                                 | GEA Market Analytics / Workbench                               | 先展示可解释证据，评分与评论在反作弊和申诉机制就绪后再开放                                   | 保留弱信号；停止把占位 average_rating 当可信度                                                | P3     | SkillHub 推荐 [#28](https://github.com/openJiuwen-ai/skillhub/issues/28) 已由 [PR #23](https://github.com/openJiuwen-ai/skillhub/pull/23) 合入                                             | 不重复投稿                                                           | 所有可信度指标标明来源、时间窗和样本量；不影响 P0 运行闭环                                                |

## 6. 产品体验：市场、装配和运行是一条旅程

### 6.1 信息架构

GEA Workbench 和 AionUi 应使用同一市场合同，客户端可以不同，但不各自拥有一套市场真相。

顶层能力市场只需要五个工作区：

1. 发现：搜索、分类、兼容过滤、组织推荐。
2. 已部署：Hosted Activation 或 Local Installation、健康、使用方、更新和回滚。
3. 发布中心：草稿、校验、版本、提交和撤回。
4. 审核中心：仅对有权限角色显示，处理安全与人工审核。
5. 组织分发：Entitlement、白名单、权限预算和团队范围。

Skill、MCP、Agent、Knowledge 是同一市场中的商品类型，不再分别建设市场。现有 Skills Settings、MCP Management 和 Agent Hub 应逐步变成“本地已安装能力”或兼容入口。

### 6.2 用户主旅程

| 阶段 | 用户看见什么                                                    | 系统必须证明什么                                              |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| 发现 | 来源、发布者、最新 approved version、权限、兼容、依赖、运行验证 | Listing 指向哪个不可变 Release                                |
| 获得 | 适用租户、组织策略、目标 Agent、所需权限                        | Entitlement 已创建，revision 可追溯                           |
| 部署 | 托管激活，或本地 staging、校验、初始化、health、失败修复        | Hosted Activation 或 Local Installation 的终态和 exact digest |
| 绑定 | 已安装能力 Drawer、Agent 影响 diff、SecretRef 缺口              | 新 AgentRevision 引用了哪个 Binding                           |
| 预检 | resolved capabilities、tool policy、secret、兼容和 degraded 项  | RuntimeBundle revision 与后续会话一致                         |
| 运行 | 对话为主，Run Rail 展示加载、工具调用、审批和产物               | 实际调用的 release、tool、policy、auditId                     |
| 交付 | final、验证、产物、OperationReceipt 和 ExecutionReceipt         | 成功不是模型自述，而是服务端终态                              |
| 治理 | used-by、更新 diff、回滚、yank、revoke                          | 新旧 session 的策略明确且有 receipt                           |

### 6.3 状态必须分开

一个商品至少有以下独立状态：

公共主干：available → entitled → deployed → bound → ready → invoked。

Deployment 必须按执行目标分支：

- GEA 托管能力：activating → activated。
- 本地 artifact：installing → installed。

并行异常状态：

review_rejected、entitlement_revoked、activation_failed、install_failed、binding_degraded、preflight_failed、runtime_failed、release_yanked、release_suspended。

界面不能再把以下动作都显示为“已启用”：

- 用户看到了商品。
- 管理员授权了商品。
- artifact 下载到了本地。
- Agent 保存了一个 ID。
- runtime 成功加载能力。
- 本次任务真正调用成功。

## 7. 两条优先纵向切片

### 7.1 Slice A：GEA 托管 MCP Capability，优先

虽然 Jiuwen 的 SkillHub 发布治理比 MCP 更成熟，但本项目的目标是先证明“与 GEA 打通”。GEA Gateway 已有 session、list、call 和 auditId，因此 MCP 是最短的真实运行路径。

流程：

1. 发布者提交一个 private hosted MCP Package 和不可变 Release。
2. GEA 完成最小 schema、权限和人工审核；只有 approved Release 进入该租户的 private Listing。
3. 用户选择目标 agentCode 并确认权限，GEA 创建 Entitlement 和 HostedActivation；托管能力不伪造本地 Installation。
4. GEA 返回 entitlementId、entitlementRevision、release/digest 和 toolSetRevision。
5. Agent Registry 创建 CapabilityBinding 和新的 AgentRevision；长期 access/delegation token 不进入 manifest、Agent 或数据库。
6. 新会话冻结 agentCode、entitlementRevision、bindingRevision 和 toolSetRevision。
7. GEA 原生 runtime 或 AionCore adapter 经现有 Gateway 调用 MCP。
8. bridge / runtime 保留 auditId、sourceCode 和 originalToolName，写统一 ExecutionReceipt；运行界面显示“来源、版本、授权和审计”。

必须通过的验收：

- 未审核 Release 不可授权；无 Entitlement 时工具不出现在 list，绕过 list 直接 call 仍被拒。
- tenant、agentCode、session、conversation 任一错配均 fail-closed。
- Assistant A 与 Assistant B 不共享一个全局 sales_forecast agentCode。
- Entitlement revoke 后新 session 不再获得工具；旧 session 行为由策略明确。
- auditId 从 GEA Gateway 完整到达 AionCore receipt 和 UI。
- access token、delegation token、Cookie、API key 不进入模型参数、日志和配置快照。

### 7.2 Slice B：Signed Skill Release

流程：

1. 发布一个 private Skill Release，冻结 version、digest、manifest 和权限。
2. GEA 审核通过后生成短期 artifact ticket。
3. AionCore 安全下载、验签、解压到 staging、验证 identity/compatibility，再原子激活。
4. LocalInstallation 绑定到新 AgentRevision。
5. AionCore 将精确 Release 物化到现有 Skill catalog；aionrs 真实加载。
6. 用一次真实 turn 证明该 Skill 被选择和执行，并生成 ExecutionReceipt。
7. 发布 v2；旧会话继续用 v1，新 revision 可选 v2。
8. v2 失败时回滚 binding，验证新会话恢复 v1。

必须通过的验收：

- 同 version 不允许不同 digest 覆盖。
- 安装刷新后 job 和 receipt 仍可查询。
- 安装成功、runtimeLoaded 和本次 selected/invoked 分开记录。
- used-by 阻止无提示卸载。
- rollback 不依赖旧 artifact 仍在线。

## 8. 建议契约

以下是规划建议，不代表已存在的 GEA API。

### 8.1 GEA Market

- GET /market/capabilities
- GET /market/capabilities/{packageId}
- GET /market/capabilities/{packageId}/releases
- POST /market/submissions
- POST /market/releases/{releaseId}:review
- POST /market/entitlements，要求 idempotencyKey
- POST /market/entitlements/{entitlementId}:revoke
- POST /market/artifact-tickets
- POST /market/agents/{agentCode}/capabilities:resolve

保留当前运行接口：

- POST /ai/gateway/agent/session
- POST /ai/gateway/mcp/proxy/list
- POST /ai/gateway/mcp/proxy/call

### 8.2 GEA Agent Registry / Resolver

- AgentRevision create / diff / publish
- CapabilityBinding bind / unbind
- RuntimeBundle resolve / preflight
- OperationReceipt / ExecutionReceipt query
- target adapter capability negotiation

### 8.3 AionCore

- catalog projection / detail
- install、update、uninstall job 与状态
- 本地 deployment / binding projection 与 preflight
- RuntimeBundle 到 conversation/backend 的目标格式映射
- conversation capability snapshot
- local install、binding、runtime、rollback receipts

会话最少冻结：

- packageId + releaseId + digest
- entitlementId + entitlementRevision
- deploymentId + executionTarget + bindingId + bindingRevision
- agentCode + toolSetRevision
- policyRevision + runtimeBundleRevision

Secret 只允许以 credentialRequirements 和 secretRefs 出现。市场 manifest、MCP transport、AgentRevision 和 Renderer 都不得获得明文 token、API key、Cookie 或连接串。

## 9. 下一阶段开发任务

### 9.1 F0 / P0：冻结跨仓合同并让 registry 真正进入 runtime

| 顺序 | Ticket / 交付物                                                                                                     | Owner / 目标仓或服务                                                   | 前置合同     | 完成标准                                                                              |
| ---: | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
|    1 | FND-01 Release identity：Publisher、Package、Listing、不可变 Release schema、稳定 ID 和 digest 规则                 | GEA Market（服务仓待确认）+ enterprise-agent-platform shared contracts | 无           | 同 version 不同 digest 被拒；多源同名不冲突；Aion manifest 可无损映射                 |
|    2 | FND-02 Entitlement / Deployment：Entitlement、HostedActivation、LocalInstallation、SecretBinding、Revocation 状态机 | GEA IAM / Market + AionCore extension                                  | FND-01       | hosted/local 权威清楚；secret 只有 ref；revoke/yank/suspend 语义分开                  |
|    3 | FND-03 Agent assembly：AgentRevision、CapabilityBinding、逻辑 RuntimeBundle 与 target adapter contract              | enterprise-agent-platform agent-runtime                                | FND-01、02   | 同一 revision 解析稳定；Renderer 不拼 Bundle；目标 adapter 不建立第二套市场身份       |
|    4 | FND-04 Receipt envelope：OperationReceipt、ExecutionReceipt、error envelope、idempotency 和关联 ID                  | GEA Gateway / runtime + AionCore + AionUi common contract              | FND-01 至 03 | publish 到 invoke 共用 envelope；auditId 可关联；敏感字段有明确禁止清单               |
|    5 | RUN-01 GEA native consumption：动态 Agent registry，Skill/MCP/Tool Policy 注入 FastAPI/LangGraph graph              | enterprise-agent-platform backend/agent-runtime 与 app API             | FND-03、04   | 删除硬编码 sales_forecast；保存 binding 会真实改变可用工具/Skill；两个 Agent 结果不同 |
|    6 | RUN-02 Desktop target adapter：动态 agentCode，RuntimeBundle 映射到 AionCore conversation snapshot                  | AionUi web-host/desktop + AionCore conversation                        | FND-03、04   | 不再共享全局 agentCode；与 GEA 原生路径冻结同一 release/entitlement/binding revision  |

### 9.2 F1 / P1：第一条 private hosted MCP 市场闭环

| 顺序 | Ticket / 交付物                                                                                                | Owner / 目标仓或服务                                                | 前置合同           | 完成标准                                                                       |
| ---: | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------ |
|    7 | MCP-01 Minimal supply：Publisher、private Package/Release submission、schema/permission validate、人工 approve | GEA Market（服务仓待确认）                                          | FND-01、04         | 未审核 Release 不可见不可授权；审批证据可查询；这不是完整运营后台              |
|    8 | MCP-02 Entitlement / Activation / Resolve：对 agentCode 授权并生成 toolSetRevision                             | GEA Market/IAM + Agent Resolver                                     | FND-02、03，MCP-01 | 无 Entitlement 不产生 RuntimeBundle；HostedActivation 不伪造本地安装           |
|    9 | MCP-03 Gateway execution proof：list/call 复核、auditId/source/tool 保留、ExecutionReceipt                     | GEA Gateway + enterprise-agent-platform runtime + AionUi GEA bridge | RUN-01、02，MCP-02 | 绕过 list 的 call 仍 fail-closed；一次真实调用可追到 exact Release 和 auditId  |
|   10 | MCP-04 Market-to-Builder UX：private Listing、权限确认、目标 Agent、Binding / Build Preview、运行证据          | GEA Workbench + AionUi                                              | MCP-01 至 03       | 用户不跨多个设置页；available、entitled、activated、bound、ready、invoked 分态 |
|   11 | MCP-05 Revoke E2E：tenant/agent/session 错配、新旧 session 策略、双 runtime 一致性、secret 泄漏                | GEA QA + AionUi/AionCore integration                                | MCP-01 至 04       | 全部 fail-closed；receipt 完整；GEA 原生和 Desktop 解析同一市场版本            |

### 9.3 F2 / P2：第二条 signed Skill 闭环

| 顺序 | Ticket / 交付物                                                                                | Owner / 目标仓或服务                                   | 前置合同                       | 完成标准                                                              |
| ---: | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------- |
|   12 | SKL-01 Signed Release：Aion extension manifest 映射、artifact ticket、digest、签名、兼容和权限 | GEA Market / Artifact Store + AionCore extension       | FND-01、02，MCP-01 的审核 seam | 同版本不可覆盖；approved 指针稳定；下载票据短期有效                   |
|   13 | SKL-02 Durable LocalInstallation：安全 staging、原子激活、job/OperationReceipt、used-by guard  | AionCore extension；现有 dirty HubInstaller 先独立审计 | SKL-01、FND-04                 | 断线刷新可恢复；失败不污染旧版；不把候选实现当已发布能力              |
|   14 | SKL-03 Dual runtime load proof：GEA native loader 与 AionCore snapshot/aionrs loader           | enterprise-agent-platform runtime + AionCore/aionrs    | RUN-01、02，SKL-02             | 两条路径用真实 turn 证明 exact Release 被 loaded、selected 和 invoked |
|   15 | SKL-04 Upgrade / rollback / yank                                                               | GEA Market + Agent Registry + AionCore                 | SKL-03                         | 旧会话固定；新 revision 显式升级；回滚离线可用；yank 不硬删           |

### 9.4 F3 / P3：产品化 private enterprise market

| 顺序 | Ticket / 交付物                                                                       | Owner / 目标仓或服务           | 前置合同            | 完成标准                                              |
| ---: | ------------------------------------------------------------------------------------- | ------------------------------ | ------------------- | ----------------------------------------------------- |
|   16 | GOV-01 Full Publisher / Review Center：版本历史、安全扫描、权限 diff、撤回            | GEA Market + GEA Workbench     | MCP-01、SKL-01      | 审核、运行验证和用户口碑分开；权限扩大触发重审        |
|   17 | GOV-02 Org Distribution：org/team/agentCode Entitlement、白名单、权限预算、到期和通知 | GEA IAM / Market               | MCP-05              | 授权变化影响新解析；历史决策与通知仍可查              |
|   18 | UX-01 Unified Storefront：发现、详情、已部署、used-by、修复路径                       | GEA Workbench + AionUi         | MCP、Skill 两条闭环 | UI 状态都来自权威合同，不建立本地假状态               |
|   19 | AST-01 AgentBundle：Agent/Team Template 安装为 draft、依赖锁、Build Preview           | GEA Agent Registry / Workbench | FND-03、GOV-01      | 模板不直接运行；缺依赖不能发布 AgentRevision          |
|   20 | AST-02 Knowledge / Workflow assets：Connector、KnowledgePack、WorkflowTemplate        | GEA Market + 对应数据/运行服务 | GOV-01、02          | 数据授权与代码包授权分开；Task 实例仍由运行域权威管理 |

F4 再考虑公共市场、收费、评论、反作弊、外部市场联邦、自动升级和可安装 A2UI。它们不应进入下一阶段关键路径。

## 10. 官方投稿清单

状态冻结于 2026-08-11。GitHub 是 openJiuwen 的同步镜像，正式认领和投稿仍应从 Issue 指向的 GitCode 入口进入，并在开始前重新查重。

| 顺序 | 官方项                                                                        | 未解决部分 / 占坑                                                     | 建议最小 PR                                                               | 预计接纳概率               |
| ---: | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------- |
|    1 | [JiuwenSwarm #2656](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2656) | Open，未发现关联 PR；市场安装失败缺错误码和详情                       | 真实 payload fixture、统一安全 error envelope、UI 展示和测试              | 高                         |
|    2 | [JiuwenSwarm #2659](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2659) | Open major，未发现关联 PR；多源同名 Skill 投影错误                    | canonical source identity、唯一投影纯函数、多源安装测试                   | 中高                       |
|    3 | [SkillHub #7](https://github.com/openJiuwen-ai/skillhub/issues/7)             | Open；PR #21 仅部分修复，群组删除后的失效通知仍缺                     | 授权失效事件、提交者/成员/pending 用户通知及测试                          | 中高                       |
|    4 | [SkillHub #36](https://github.com/openJiuwen-ai/skillhub/issues/36)           | Open，未发现关联 PR；升级后历史群组状态未修复                         | 幂等数据迁移或兼容读取，覆盖旧数据 fixture                                | 中                         |
|    5 | [JiuwenSwarm #2031](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2031) | Open，未发现关联 PR；本地 Skill 更新要卸载重装                        | source fingerprint、显式差异检测和重新导入                                | 中                         |
|    6 | [JiuwenSwarm #2533](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2533) | Open major，未发现有效关联 PR；版本与回退范围大                       | 先提交安装账本、版本解析和 rollback contract，小步实现                    | 完整功能低，拆分后中       |
|    7 | [SkillHub #49](https://github.com/openJiuwen-ai/skillhub/issues/49)           | Open major，未占坑；要求 Agent/Team Template、Plugin 成为平级市场资产 | 先与 Maintainer 对齐 manifest/schema，再做 validator、CLI 或 API 原子切片 | 完整功能低，评审后小切片中 |
|    8 | [Agent Studio #305](https://github.com/openJiuwen-ai/agent-studio/issues/305) | Open major；插件版本回退与 AgentArts 语义耦合                         | 先确认版本存储和运行态切换契约，再补单一回退 seam                         | 中低                       |

不应重复投稿：

- [JiuwenSwarm #2184](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2184) 的 MCP 生命周期已有大型 WIP [PR #2574](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2574)。
- [SkillHub #28](https://github.com/openJiuwen-ai/skillhub/issues/28) 的推荐能力已有合并的 [PR #23](https://github.com/openJiuwen-ai/skillhub/pull/23)。
- embedding 配置问题 [JiuwenSwarm #215](https://github.com/openJiuwen-ai/jiuwenswarm/issues/215) 虽仍 Open，但 develop 已有指纹与重建主链，必须先复现新缺口。
- Team A2UI [JiuwenSwarm #2256](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2256) 已由 [PR #2257](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2257) 合入，不因 Issue 未关重复实现。

上游投稿优先级不能替代 GEA 路线优先级。#2656 和 #2659 适合作为独立外部贡献，但 GEA 的 Package / Entitlement / Binding / ExecutionReceipt 必须在本地先建，不存在可直接从 Jiuwen 抄来的完整实现。

## 11. 与当前工作树的关系

此前工作树给 TeamControlBoard 增加 Live、Attempt、阻塞子任务、列折叠和渐进展示，这些局部能力可以保留；但它们与市场不是同一条产品主线。

当前 Team Work 仍有 legacy team_tasks 与 durable team_work_tasks 双任务域，且 Governance Prompt 还在引导 Agent 写旧工具。这个问题应作为独立 release blocker 修复：

- 保留 AionCore Team Work Kernel、版本化命令、snapshot/event reconcile。
- 将 legacy task 迁移或适配为 Team Work 唯一权威。
- Board 改成对话工作区里的 split view / Run Rail，而不是与聊天互斥的第三种模式。
- Activity、Attention 和 Task 都从同一 ordered event 投影。

不要把这项迁移塞进市场 Epic，也不要继续用新的市场、看板或设置页面掩盖两套状态事实。

## 12. 明确停止项

- 不新建另一套 Resource Center 或 Skill/MCP mini-market。
- 不让 AionUi 成为市场、Entitlement 或运行状态权威。
- 不再保存运行时不消费的 skill_ids 后显示“保存成功”。
- 不把 AionHub 静态 raw index 直接当企业可信目录。
- 不在 manifest、Assistant、MCP config 或日志中保存明文 secret。
- 不允许同 version 不同 digest 覆盖。
- 不把安装完成、绑定完成、预检通过和真实调用成功合成一个状态。
- 不先做评分、评论、付费、公共联邦和自动升级。
- 不把真实 Task、Todo、Attention 或 ProcessEvent 设计成市场商品。
- 不从 Jiuwen 复制 Python registry、本地进程 job、硬删除版本或任意 A2UI 执行模型。

## 13. 下一阶段完成定义

下一阶段不是“市场页面上线”，而是下面两条证明同时成立：

1. 一个 GEA 私有 MCP Capability 能完成发布、审核，从 Listing / Release / Entitlement / HostedActivation 进入一个明确 AgentRevision，经过真实 Gateway tool call，并把 auditId 和 ExecutionReceipt 带回运行界面；撤回后按策略 fail-closed。
2. 一个私有 Skill Release 能以精确 version + digest 被审核、安装、绑定、由 aionrs 实际加载、升级和回滚；旧会话与新会话版本语义明确。

达到这两点后，市场首页、发布中心、组织分发、Agent Template 和 Knowledge Connector 才是在扩展同一条主链；否则仍然只是新的功能堆叠。

## 14. 资料与状态说明

- JiuwenSwarm 能力源码快照与 Issue/PR 刷新口径见 [Jiuwen 能力与投稿矩阵](./jiuwen-capability-adoption-matrix.md)。
- AionHub 参考当前官方仓库及其 [extension manifest schema](https://github.com/iOfficeAI/AionHub/blob/spec/v0/extension-manifest.schema.json)。
- AionCore 本地主工作树存在未提交的 HubInstaller 增强，只作为候选资产；落地前必须单独审计和验证。
- GEA Market 服务端尚未在本次可见仓库中发现；所有建议 API 需与真实服务所有者确认后冻结。
- 本文只重写规划，不修改 AionUi、AionCore、GEA 或 enterprise-agent-platform 的业务代码。
