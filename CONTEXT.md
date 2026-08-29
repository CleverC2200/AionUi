# AionUi

AionUi 是面向人的 Agent 协作工作区。用户在会话中发起工作、观察执行、处理需要介入的请求，并检查最终交付。

## 工作空间

**Conversation（会话）**：
人与一个 Agent runtime 持续工作的空间，保存消息、运行上下文和本次实际使用的配置。
_避免使用_：Work Session、Task、Agent

**Turn（轮次）**：
会话中由一次用户请求发起并以响应、等待介入、失败或取消结束的一次执行过程。
_避免使用_：Run、Task、Conversation

**Assistant（助手）**：
客户端中可启用并用于发起会话的 Agent 配置；可以受 Assistant Template 管理，也可以由用户独立维护。
_避免使用_：Assistant Template、Agent runtime、Conversation、Turn

**Assistant Template（助手模板）**：
由 GEA 管理平台发布并版本化的受管配置来源，声明身份、规则、默认选项、Agent、Skill、MCP 依赖以及企业使用策略。
_避免使用_：官方助手、Assistant、Agent runtime

**Assistant Template Version（助手模板版本）**：
Assistant Template 一次不可变的发布结果；Assistant Assignment 明确指向目标版本，客户端不自行选择最新版。
_避免使用_：草稿、客户端版本、自动更新偏好

**Assistant Manifest（助手清单）**：
一个 Assistant Template Version 中锁定的 Agent、Skill、MCP、最低客户端版本、扩展策略及内容摘要集合，不包含密钥或用户身份数据。
_避免使用_：Capability Snapshot、用户扩展、运行凭据

**Assistant Assignment（助手分配）**：
GEA 将一个 Assistant Template 版本授予企业、用户或用户组使用的关系，决定可见性、必选性和撤回状态，与客户端启用偏好保持独立。
_避免使用_：Assistant、启用状态、用户偏好

**Managed Assistant（受管助手）**：
客户端中保留 Assistant Template 来源、版本和企业策略关系，并按企业分配持续同步且不能脱离策略修改的 Assistant。
_避免使用_：官方助手、助手副本、本地助手

**Assistant Extension（助手扩展）**：
用户附加到 Managed Assistant 的增量配置，只能增加企业策略允许的 Skill 和 MCP，不能替换、关闭或修改模板持有的配置，也不继承额外企业权限。
_避免使用_：助手副本、模板修改、Managed Assistant

**Enterprise Assistant Catalog（企业助手目录）**：
GEA 面向当前企业身份发布的 Assistant Assignment 集合；客户端可以缓存最近一次完整目录，但缓存不代表生产授权仍然有效。
_避免使用_：官方助手列表、能力市场、本地 Assistant 列表

**Agent Runtime（Agent 运行时）**：
实际执行会话轮次并产生消息、工具调用和输出的运行主体。
_避免使用_：Assistant、Conversation

## 身份与会话

**Lark External Identity（Lark 外部身份）**：
由 provider `lark`、`issuer`、`tenant_id` 与该租户内稳定的 `subject` 组成的身份元组；同一 subject 在不同租户中表示不同身份。
_避免使用_：AionPro 用户、Core User、GEA Credential

**External Identity Mapping（外部身份映射）**：
AionCore 权威维护从外部身份元组到 Core User 的唯一对应关系；该关系只能由可信宿主引导（trusted host/bootstrap）建立。
_避免使用_：客户端用户映射、共享 Core 用户、AionPro 映射

**Core User（Core 用户）**：
AionCore 中数据、权限与审计记录的归属主体；不同 Lark External Identity 不共用 Core User。
_避免使用_：Lark External Identity、共享 Core 用户、系统默认用户

**Core Session（Core 会话）**：
AionCore 为一个 Core User 签发并验证的认证会话；外部凭据不直接充当 Core Session。
_避免使用_：Conversation、GEA Credential、Lark access token

**Navigation Reference（导航引用）**：
由 GEA 管理端签发的短期、不透明、可撤销引用；外部链接只携带该引用和协议版本，客户端登录后由 AionCore 在当前身份、租户与环境下解析，引用本身不包含本地路由、会话标识、消息内容或凭据。
_避免使用_：Conversation ID、路由参数、登录令牌、一次性消费令牌

**Client Navigation Target（客户端导航目标）**：
AionCore 在完成 Navigation Reference 的身份、租户、环境与授权校验后，映射出的有类型本地 Interaction Location；当前类型为 Conversation、Message、Interaction Request、Team 或 Slot，客户端只按该类型执行受限导航。
_避免使用_：Navigation Reference、任意 URL、管理端业务对象

**GEA Credential（GEA 凭据）**：
由 GEA 或 Lark 签发、用于验证外部身份或访问平台能力的敏感凭据，包括 Lark access token；它不是 Core JWT 或 Core Session，也不得交付浏览器。
_避免使用_：Core JWT、Core Session、浏览器会话令牌

## 团队协作

**Team（团队）**：
围绕一个共享工作区组织多个成员会话的协作容器。
_避免使用_：Conversation、Task Board

**Team Run（团队运行）**：
由一次用户操作或系统生命周期操作发起、跨团队成员协调工作的运行信封。
_避免使用_：Turn、Team Task、Conversation

**Team Task（团队任务）**：
团队活动中可持续更新的协作工作项，与成员会话和团队运行保持独立身份。
_避免使用_：Plan、Scheduled Task、Turn

## 计划与调度

**Plan（执行计划）**：
一个轮次内部用于说明当前执行步骤的临时计划。
_避免使用_：Team Task、Scheduled Task、Todo

**Scheduled Task（定时任务）**：
在未来时间触发或复用会话并发起新轮次的持久调度配置，与被触发对象保持独立身份。
_避免使用_：Plan、Team Task、Todo

## 能力与上下文

**Skill（技能）**：
Agent runtime 可加载并遵循的行为说明。
_避免使用_：MCP Server、Context Source

**MCP Server（MCP 服务）**：
向 Agent runtime 提供可发现、可调用工具的服务。
_避免使用_：Skill、Context Source

**Context Source（上下文来源）**：
在一个轮次中被提供为事实或背景入口的资源角色，例如文件、URL 或知识连接；同一资源在其他轮次中可以承担输出角色。
_避免使用_：Skill、MCP Server、Output

**Context Evidence（上下文证据）**：
一个轮次从上下文来源实际读取并采用的事实材料，保留对来源及其可用版本或内容摘要的引用。
_避免使用_：Context Source、Output、Skill

**Conversation Configuration Snapshot（会话配置快照）**：
一个会话在配置准备和策略校验完成后实际采用的配置及来源证据，包含助手模板版本、Agent 运行时、能力快照、上下文来源引用及初始运行选项。
_避免使用_：Assistant Manifest、实时配置、Capability Snapshot

**Capability Snapshot（能力快照）**：
会话配置快照中冻结实际 Skill、MCP 选择及其加载结果的部分；Team 只能汇总成员会话的能力快照。
_避免使用_：Conversation Configuration Snapshot、Assistant Manifest、Capability Registry

**Runtime Option State（运行选项状态）**：
会话中当前生效且允许调整的模型、权限模式和思考等级等运行选项，与会话创建时的配置快照保持区分。
_避免使用_：Conversation Configuration Snapshot、Capability Snapshot、Assistant Defaults

**Assistant Preparation Status（助手准备状态）**：
客户端对目录、助手清单及本机依赖是否完整可加载的状态投影，不代表当前轮次已获得企业或业务授权。
_避免使用_：Assistant Assignment、Turn Validation、业务授权

**Turn Validation（轮次校验）**：
受管轮次开始前对当前分配、会话配置和企业策略所作的授权判断；其结果属于来源轮次且不改写会话配置快照。
_避免使用_：Assistant Preparation Status、Capability Snapshot、Completion Receipt

## 人工介入

**Interaction Request（交互请求）**：
由来源会话轮次或团队任务唯一持有、等待特定用户回答或决策的请求。Ask、Permission、Approval、Review 可以表现为交互请求；Blocked、Failed、Indeterminate Outcome 只有在存在明确用户动作时才产生交互请求。
_避免使用_：Attention、Notification、Failure

**Attention（待处理）**：
跨会话汇总当前用户有权且需要处理的未解决交互请求及其来源引用的只读投影；徽标数量由这些未解决请求计算，其状态以来源为准，本地缓存不构成新的权威状态。
_避免使用_：Interaction Request、Notification、Task state

**Attention Item（待处理项）**：
Attention 中一个尚未解决的交互请求的只读条目；表达用户现在需要采取的动作，并保留稳定身份和交互位置，但不拥有独立的可写业务状态。处理结果必须由来源确认；已处理、过期或无权处理的来源仍可保留只读历史。
_避免使用_：Interaction Request、Task、Failure

**Interaction Location（交互位置）**：
交互请求在来源会话轮次、会话交互卡或团队任务及成员会话中的原始位置，用于让用户返回事情发生处继续处理。
_避免使用_：Attention Item、Navigation history、Notification target

**Recovery Action（恢复动作）**：
来源为 Blocked 或 Failed 状态明确提供、可由用户执行以解除阻塞或结束工作的动作；客户端不得根据错误文本自行推断恢复动作。
_避免使用_：Retry、Interaction Request、Troubleshooting hint

**Interaction Resolution（交互解决）**：
来源确认交互请求已回答、拒绝、取消、过期或因其他权威变化而关闭的结果。解决后退出活动待处理投影，历史仍保留在来源；关闭界面、读取通知或本地移除待处理项都不构成交互解决。
_避免使用_：Notification read、Dismiss、Optimistic update

**Notification（通知）**：
向用户传达新增、紧急、即将过期或阻塞事项的可选信号；可以被读取或关闭，但不持有交互请求状态，也不改变待处理数量。
_避免使用_：Attention、Interaction Request、Interaction Resolution

**Turn Resume（轮次恢复）**：
交互解决后，同一个可安全续接的轮次从等待状态继续执行；如果原轮次不可恢复，则明确结束并由用户发起新轮次，不能暗中替换为新轮次。
_避免使用_：Retry、New Turn、Background rerun

**Indeterminate Outcome（结果待核实）**：
外部写入请求已经发出但实际业务结果尚无法确认的状态；完成对账前不能把它视为失败或再次提交。
_避免使用_：Failure、Interaction Request、Completion Receipt

## 结果与交付

**Conversation Artifact（会话交互卡）**：
由会话持久保存、可供用户处理的结构化交互内容。
_避免使用_：Output、Deliverable、文件产物

**Output（输出资源）**：
由一个轮次产生并归属于该轮次的特定文件版本、URL、数据或其他可引用结果；其身份固定当时的内容或权威版本，同一底层资源可以在后续轮次中转为上下文来源。
_避免使用_：Context Source、Conversation Artifact、Deliverable

**Execution Record（执行记录）**：
属于来源轮次的工具调用、终端日志和原始返回等过程记录；只有被保存、引用或明确提供后才成为输出资源。
_避免使用_：Output、Context Evidence、Activity

**External Result（外部业务结果）**：
外部系统确认业务写入后产生的结构化输出资源，保留业务对象标识、提交当时的权威结果和发生时间；后续当前状态可以变化，但不改写当时结果，结果待核实时不能将其表述为成功结果。
_避免使用_：Completion Receipt、Indeterminate Outcome、Tool output

**Output Availability（输出可用性）**：
输出资源当前是否仍可打开或取得的状态，与输出身份及其曾经产生和交付的事实保持独立。
_避免使用_：Output identity、Completion status、Retention policy

**Deliverable（交付物）**：
属于会话或团队任务、可持续修订的具名成果身份；其每次提交通过交付物修订版固定引用来源轮次输出并供用户检查和继续使用。
_避免使用_：Output、Completion Receipt、Final answer

**Deliverable Revision（交付物修订版）**：
一个交付物一次不可变的提交结果，固定当次说明及其引用的输出版本；后续修改产生新修订版，输出当前不可访问也不删除或改写既有记录，被选中继续使用时可以成为新轮次的上下文来源。
_避免使用_：Output Version、Working file、Completion Receipt

**Progress Summary（进展摘要）**：
对尚未满足完成条件的工作现状、已有输出、阻塞和下一步的说明，不构成工作完成声明。
_避免使用_：Completion Receipt、Deliverable Revision、Final answer

**Completion Receipt（完成回执）**：
在产生可复用文件、外部业务结果、Team Task 结果或其他明确可验收成果的工作被提交为完成时，指向来源轮次或团队任务及一个或多个交付物修订版，并说明完成状态、验证结果和剩余风险的证据记录；Team 成员贡献输出，但只有任务责任方或 Leader 可以汇总提交，轮次结束和用户验收都不是完成回执本身。
_避免使用_：Deliverable、Final answer、Activity log

**Acceptance Decision（验收决定）**：
用户或授权 Reviewer 对交付物修订版作出的接受或要求修改决定；要求修改必须说明原因，并产生指向原修订版的交互请求及后续新轮次，但不改写原完成回执。
_避免使用_：Completion Receipt、Interaction Resolution、Approval

**Acceptance Requirement（验收要求）**：
由助手模板、团队任务或业务流程声明的交付验收级别，区分必须验收、可选验收和无需验收；客户端不能自行降低该要求。
_避免使用_：Acceptance Decision、Permission、Client preference

**Verification Evidence（验证证据）**：
针对一个输出或完成声明记录的验证对象、方法、时间和结果，结果明确区分通过、失败、未执行和不适用；强制验证未通过或未执行时不能形成完成回执。
_避免使用_：Context Evidence、Execution Record、Completion Receipt
