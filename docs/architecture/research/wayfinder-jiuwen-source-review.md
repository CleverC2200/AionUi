# openJiuwen / JiuwenSwarm 一手源码审查：可借模式与边界

> 审查日期：2026-08-11。目的：为 AionUi / AionCore 后续统一规划提供可验证的输入，而不是采纳现有工作树的任何计划或实现。本文不构成实现方案。

## 审查范围与方法

本次固定并阅读了默认（或开发）分支的官方仓库源码、同仓官方文档与测试：

- `openJiuwen-ai/jiuwenswarm` [`develop` @ `7e7063a`](https://github.com/openJiuwen-ai/jiuwenswarm/tree/7e7063a1a98b53cc0e6d67265a97eb3b2336a912)
- `openJiuwen-ai/agent-core` [`develop` @ `9e50ea5`](https://github.com/openJiuwen-ai/agent-core/tree/9e50ea57fcea0446447112c90cf905b76281380a)
- `openJiuwen-ai/agent-memory` [`develop` @ `600432b`](https://github.com/openJiuwen-ai/agent-memory/tree/600432b55e480bec5948ee40089884ccf15a7c5d)
- `openJiuwen-ai/deepsearch` [`main` @ `62aa0e3`](https://github.com/openJiuwen-ai/deepsearch/tree/62aa0e3718d83806aa42c4d89dfe33c2c3a11db0)

没有以 README 或截图单独推出架构结论：每项“可借”至少由运行代码、测试或官方开发文档交叉支撑。`agent-studio` 被核对为 Studio 产品线，但没有发现比前三者更直接的运行时事实，因此不将其旧运行时结构作为 AionCore 的依据。

## 总结判断

最值得吸收的不是 JiuwenSwarm 的“功能清单”，而是四个可串联的原则：

1. **能力装配有唯一的声明源**：一个 Agent profile 只声明需要什么；运行时将声明解析为能力、策略和临时句柄，避免 UI、配置、运行时各维护一份组合逻辑。
2. **生命周期与展示状态分开**：Skill/MCP/Memory/任务都需要权威状态、操作、错误和恢复；UI 只订阅带关联 ID 的事件投影。
3. **过程交互是协议，不是聊天文本**：工具开始、增量、结果、待办快照、澄清、审批、取消等必须为可恢复的事件，而不是靠模型文案或单个 loading 区块推断。
4. **知识必须可追溯、记忆必须可治理**：知识检索返回来源、片段和置信度；长期记忆有 scope、类型、检索、编辑、删除和健康状态。

这些原则能把“Skill、MCP、知识库、任务、待办”从设置页与对话页的功能堆叠，收敛为一次任务运行中的连续工作台。

## 可借模式、不可照搬项与归属

| 领域 | 一手事实 | 可借模式 | 不应照搬 | AionUi / AionCore 边界 |
| --- | --- | --- | --- | --- |
| Agent 配置与装配 | `AgentDefinition` 将模型、允许/禁止工具、权限、memory scope、预加载 skill、迭代上限与适用场景放在同一 profile；agent-core 则将“解析 parts”和“应用到实例”拆开，并让 capability 通过单一 manifest/provider registry 装配。 [JiuwenSwarm profile](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/server/runtime/agent_config_service.py#L64-L118)；[agent-core 装配决策与验证](https://github.com/openJiuwen-ai/agent-core/blob/9e50ea57fcea0446447112c90cf905b76281380a/openjiuwen/agent_teams/docs/features/F_32_declarative-harness-assembly.md#L34-L95)。 | 定义一个**版本化 Agent Profile**（identity、model policy、capability bindings、memory policy、permission policy、presentation hints），由 AionCore 解析成不可变的 `RunPlan`；能力声明使用有命名空间的 provider/catalog，避免 ad-hoc UI 挂载。 | 不复制 markdown 文件覆盖优先级、Python rail/class registry 或把运行时 handle 序列化到 profile。UI 颜色等表现字段也不能成为执行契约。 | **AionCore**：profile schema、解析、校验、版本/兼容性、run plan。**AionUi**：profile 编辑器、差异预览、兼容性与风险提示；所有写入仍走 adapter。 |
| Skill 生命周期 | JiuwenSwarm 的 Skill 检索索引把安装清单 fingerprint、索引完整性、进度、日志、取消和 interrupted recovery 作为显式状态；能力构造时还会按 workspace/团队上下文和禁用状态筛选可见 Skill。 [索引状态与 freshness](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/symphony/skill_retrieval/index_service.py#L42-L88)；[构建状态机](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/symphony/skill_retrieval/index_service.py#L90-L168)；[按上下文筛选](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/agents/swarm/providers/tools.py#L154-L227)。 | 将 Skill 设计成**制品 + 安装版本 + 启用 binding + 索引/验证 job**四个独立对象。运行前冻结 binding；升级、禁用、重建索引不会暗中改变正在执行的任务。 | 不把“为 LLM 生成 Skill Tree”当成所有 Skill 的前提，也不照搬多来源商店/自动演进入口。先解决本地/组织/项目三级来源、信任、签名（或审核）与可回滚。 | **AionCore**：解析、安装/校验 job、可见性与启用判定、运行快照。**AionUi**：Skill Hub 只呈现来源、版本、信任、依赖、使用者和 job 进度；不在 Renderer 解析/执行 skill 文件。 |
| MCP 生命周期 | 运行配置显式区分 transport、enabled、stdio 的 command/cwd/env 和 HTTP headers/timeout，并可推导 scoped stable server ID；HTTP MCP 先做可达性预检，以免失败连接遗留后台任务。 [配置与稳定 ID](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/common/mcp_config.py#L20-L119)；[预检的故障动机](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/common/mcp_config.py#L122-L168)；[stdio 生命周期测试（连接失败清理、断开幂等、移除先断连）](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/tests/unit_tests/test_mcp_stdio_lifecycle.py#L75-L211)。 | 采用**Server definition / Connection instance / Capability snapshot / Run binding**四层模型。删除配置不是“已释放连接”；只有 teardown 成功才更新权威状态。MCP UI 需显示上次检查、认证、连接、发现工具、失败阶段和下一步。 | 不把 TCP 预检误报为 MCP 可用，也不把 credential、header、stdio env 回显给 Renderer；不能将浏览器内置 MCP 这类 Electron 进程细节迁入 AionCore 业务模型。 | **AionCore**：连接池、凭据引用、握手/refresh、能力快照、运行绑定、teardown/retry 语义。**AionUi**：安全配置向导、健康/诊断与关联 run；桌面本地 stdio 的进程托管仅经 Main/preload，再由 adapter 取得状态。 |
| 知识库与长期记忆 | agent-memory 对每次写入携带 `user_id` + `scope_id`，返回 profile/semantic/episodic/summary 分类；检索把细粒度记忆和会话摘要分为两个接口，支持按 ID 更新/删除；其 MCP 以锁保护懒初始化，失败转为结构化错误且提供 health。 [写入与双检索](https://github.com/openJiuwen-ai/agent-memory/blob/600432b55e480bec5948ee40089884ccf15a7c5d/jiuwen_memory/server/mcp_server.py#L197-L289)；[懒初始化与健康检查](https://github.com/openJiuwen-ai/agent-memory/blob/600432b55e480bec5948ee40089884ccf15a7c5d/jiuwen_memory/server/mcp_server.py#L301-L372)；[DeepSearch 的本地/网页混合检索与片段级引文目标](https://github.com/openJiuwen-ai/deepsearch/blob/62aa0e3718d83806aa42c4d89dfe33c2c3a11db0/README.md#L20-L35)。 | 统一为 **KnowledgeSource / IndexVersion / RetrievalEvidence** 与 **MemoryRecord / MemoryScope / MemoryPolicy** 两条模型。每次回答或工具决策可带 evidence（来源、片段、score、索引版本）；记忆必须可查看、纠正、删除和按 scope 隔离。 | 不把所有对话原文自动抽取并持久化为“记忆”，更不能让 MCP 成为 AionCore 内部记忆 API 的唯一入口。README 中的 DeepSearch 架构只可用作追溯目标，不足以规定 AionCore 检索实现。 | **AionCore**：租户/用户/会话 scope、写入策略、检索、权限过滤、证据和审计。**AionUi**：知识来源与索引状态、回答引用卡、记忆管理/撤回；不处理向量检索或把原文塞入渲染层状态。 |
| 任务与待办 | agent-core 将待办挂在 session workspace，带锁读写；TaskPlanningRail 在生命周期中注册/卸载 todo tools、周期性督促检查，并在任务结束清理 session 资源。 [session-scoped 存储与锁](https://github.com/openJiuwen-ai/agent-core/blob/9e50ea57fcea0446447112c90cf905b76281380a/openjiuwen/harness/tools/todo.py#L95-L181)；[注册、进度与清理](https://github.com/openJiuwen-ai/agent-core/blob/9e50ea57fcea0446447112c90cf905b76281380a/openjiuwen/harness/rails/task_planning_rail.py#L80-L148)。JiuwenSwarm 在 todo 工具调用后从主 Agent 的权威 workspace 读取完整快照，再发 `todo.updated`，刻意避开 subagent 覆盖主任务的问题。 [权威快照](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L704-L740)；[前端投影](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L872-L964)。 | 将**用户工作项**与**一次 Run 的执行步骤/待办**分离；后者由 AionCore 维护 authority + revision，事件传“整份可渲染快照或 versioned patch”。中断/续跑时保留可解释的未完成步骤与输出缺口。 | 不用本地 JSON 文件作为跨设备、跨 agent 的事实源，也不隐藏 cancelled 项来伪造“全部完成”。待办不应替代项目任务、审批或长期日程。 | **AionCore**：Task/Run/Step/Todo 状态机、并发控制、resume、审计和权威快照。**AionUi**：对话内的连续计划面板、任务详情与跨会话工作台；UI 只发意图，不自行推断完成状态。 |
| 运行过程交互与人机协作 | Stream rail 为同一 tool call ID 顺序发送 `tool_call`、in-progress、`tool_result`，并把 `ask_user` 中断转换为专门事件；还按 session 管理 pause/resume/abort、在结束清理所有临时状态。 [工具事件与澄清事件](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L663-L850)；[取消与清理](https://github.com/openJiuwen-ai/jiuwenswarm/blob/7e7063a1a98b53cc0e6d67265a97eb3b2336a912/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L429-L508)。agent-core 的权限 rail 明确区分 allow/deny/ask，且 ask 的一次、会话内一直允许、持久允许是不同结果。 [权限决策分支](https://github.com/openJiuwen-ai/agent-core/blob/9e50ea57fcea0446447112c90cf905b76281380a/openjiuwen/harness/rails/security/tool_security_rail.py#L427-L590)。 | 定义**版本化 Run Event 协议**：`run/step/tool/approval/question/todo/evidence/artifact` 各有稳定 ID、状态、时间与可重放 payload；把“澄清问题”和“高风险操作审批”做成不同 card 与恢复入口。取消必须有 requested → stopping → cancelled/failed/completed 的可观察闭环。 | 不照搬 Python 的 rail 回调或把原始工具参数、60k 截断结果一律展示。也不应把模型生成的 display text 当作事实；需要可读摘要与原始证据分层、并执行敏感信息脱敏。 | **AionCore**：事件生成、排序、幂等、恢复、权限与取消语义。**AionUi**：把事件投影为统一的任务时间线与右侧工作面板，提供 pause/cancel/approve/answer；通过既有 adapter HTTP/WS 契约接入，不新建旁路 Electron IPC。 |

## 对统一体验的直接约束

后续原型和修改方案应先验证下面这条连续路径，而不是分别新增六个独立页面：

```text
选择 Agent Profile / capability bindings
        ↓ 预检（Skill、MCP、知识、权限）
创建 RunPlan 与初始 Todo
        ↓
对话时间线：文本 + 工具过程 + 引用证据 + 问题/审批
        ↔ 右侧任务工作面板：计划、待办、运行、连接健康
        ↓
结束：结果、artifact、evidence、待恢复事项、可治理记忆
```

其中“设置”改变未来 run 的 profile/binding；“当前会话”展示已冻结的 run snapshot；“任务中心”展示可恢复的 Task/Run。三者不可共用一份无版本的前端表单状态。

## 建议先验证的架构决策（非实施拆分）

1. **AionCore 是否能成为唯一 Task/Run/Step 事实源？** 若不能，先明确桌面离线 run 与服务端 run 的同步、冲突和恢复责任，再做 UI。
2. **是否采用 capability binding 的快照语义？** 要确认 Skill/MCP/知识库配置更新后，运行中和恢复中的任务究竟使用哪一版；这是避免“设置改了、过程变了”的前提。
3. **Run Event 最小协议是什么？** 先用一条有工具、引用、todo、审批、中断的真实链路验证顺序、去重、重放与脱敏，再扩展到所有能力。
4. **知识与记忆的治理边界在哪里？** 在接入自动写入前，先锁定 scope、可见性、删除语义、来源引用与审计要求。

## 结论的置信边界

- 以上“可借”均为模式层建议，不意味着 JiuwenSwarm 已在多租户、跨设备或 AionCore 的部署条件下完成验证。
- JiuwenSwarm 的某些 UI 截图、市场来源和自演进流程属于产品选择，不能替代 AionUi 的现有交互与安全边界设计。
- 本次未运行外部项目测试；证据是固定提交的官方源码、官方开发文档与其测试代码。采纳前应在 AionCore 当前契约和 AionUi adapter 上做一条端到端验证。
