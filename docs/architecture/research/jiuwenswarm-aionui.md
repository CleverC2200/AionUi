# JiuwenSwarm 对 AionUi 的可迁移能力调研

> 调研日期：2026-08-11
>
> 主仓快照：[`openJiuwen-ai/jiuwenswarm@91c9f36`](https://github.com/openJiuwen-ai/jiuwenswarm/commit/91c9f367a8308ac95f9b688905fa76f3eabd55e7)，默认分支 `develop`。组织内相邻仓库也固定到下文列出的提交。
>
> 范围：Agent 配置、Skill、MCP、知识库、记忆、任务/待办和运行过程交互；仅使用 openJiuwen 官方仓库、源码、文档、Issue、PR 和维护者回复。
> 判定：`已实现` 表示当前源码存在可运行链路；`文档声称` 表示官方文档描述但本次未追到完整运行链路；`规划中` 表示 Issue/设计提案；`同组织参考` 表示 JiuwenSwarm 当前没有直接集成。

## 结论

最值得迁移的不是某个页面，而是六个产品和运行时边界：

1. **Agent 使用可序列化能力清单构建**：把静态 Agent 定义、动态会话上下文、能力装配和运行状态分开。AionUi 只编辑/展示清单，AionCore 验证并实例化。
2. **Skill 是有生命周期的能力包**：统一安装来源、来源身份、启停、索引、调用轨迹、更新和失败诊断；Skill 创建采用确定性状态机和可恢复的人工确认点。
3. **MCP 是工作区能力控制面**：统一标准化配置、预检、启停、重载、工具发现、敏感字段遮蔽和 Agent/Team 隔离，不能只是一个 JSON 文本框。
4. **任务计划和用户待办必须分域**：Agent 内部执行计划、用户个人待办、Team 工作三者语义和权威来源不同。AionUi 只能投影 AionCore 的 Team Work 状态，不能复制 JiuwenSwarm 的本地 JSON/Markdown 权威。
5. **过程交互使用结构化事件槽位**：权限、澄清问题、计划审批、工具进度、子任务、Team 成员活动和最终回答是不同事件类型，不能都折叠成普通聊天消息。
6. **知识与记忆要保留来源和写入边界**：JiuwenSwarm 的 Markdown Wiki/Memory 很适合“可读、可审计的本地材料”，DeepSearch 的引用链更适合研究型知识库；AionCore 仍应持有 corpus/chunk/citation 的权威标识。

建议优先级：

| 优先级 | 建议进入 AionUi/AionCore 的能力                                                                | 原因                                                   |
| ------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| P0     | Agent 能力清单与构建预览；MCP 生命周期控制面；计划/个人待办/Team Work 分域；统一过程事件模型   | 先解决权威、契约和可诊断性，避免后续 UI 形成第二套状态 |
| P1     | Skill 生命周期、来源身份与选择解释；结构化权限/问答/计划审批；知识来源与引用；跨会话记忆可见性 | 直接改善可控性、复用和用户信任                         |
| P2     | SkillDev 确定性创建流程；A2UI 固定组件协议；Skill 检索图和离线反馈；调试回放                   | 有价值，但应建立在 P0 事件和状态契约之上               |
| 暂缓   | 静默 Skill 自演进、模型生成任意 UI、以聊天历史或本地文件充当 Team 权威                         | 容易造成不可审计变更、注入面和状态分叉                 |

**投稿入口要单独注意**：官方贡献指南要求在 **GitCode** Fork/提 PR，目标分支是 `develop`，并经过 CI 和至少两位 Committer 审查；GitHub 是同步镜像。所以下文的 GitHub Open Issue/PR 只用于检索和交叉核验，不能当成官方已受理、无人占坑或最终合并状态的唯一证明。真正动手前应在 GitCode 再查重并与对应 Issue 对齐。

## 1. Agent 配置与运行时装配

### 可借鉴机制

JiuwenSwarm 的 Swarm 构建层把 Agent 描述拆成 `RailSpec`、`BuiltinToolSpec`、`SubAgentSpec`，再由注册表解析 provider 并实例化；静态配置放在 `params`，会话/请求相关环境放在 `SwarmBuildContext`，同时保留可序列化 seed，供 spawn、分布式构建和冷恢复使用。机制见 [`agents/swarm/DESIGN.md`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/swarm/DESIGN.md)、[`config_specs.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/swarm/config_specs.py)、[`assembly.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/swarm/assembly.py) 和 [`registry.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/swarm/registry.py)。**状态：已实现。**

`assembly.py` 在 Team 构建时补齐 leader/teammate 上下文，并给 MCP 使用 `team:<team_name>` 隔离 scope；这比让 UI 拼一份完整运行时对象更稳妥。Agent 工作区还把 `AGENT.md`、`IDENTITY.md`、`SOUL.md`、`USER.md`、`HEARTBEAT.md` 和 Skills 分文件保存，模板见 [`resources/agent/workspace`](https://github.com/openJiuwen-ai/jiuwenswarm/tree/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/resources/agent/workspace)。**状态：已实现。**

优点：

- 描述可序列化、装配可注册，便于版本化、分布式构建和能力审计；
- 静态意图与动态环境分离，避免把 secret、连接句柄和会话状态写进 Agent 模板；
- Team 成员可复用同一构建协议，而不是每种模式各写一套初始化逻辑。

局限：

- `mode`、`work_mode`、`code.team`、`team.plan` 等概念较多，公开 Issue 已出现模式与 Todo 行为混淆；AionUi 不应照搬模式数量；
- Python provider registry 是 JiuwenSwarm 的运行时实现，不适合作为 AionUi Renderer 的本地状态模型；
- 模板文件可读，但缺少一份面向产品层的、带 schema/version/capability diff 的统一 manifest。

### AionUi 迁移建议

定义由 AionCore 校验的 `AgentManifest`，至少包含：

```text
identity / instructions / modelPolicy
tools[] / skills[] / mcpServers[] / knowledgeBindings[]
memoryPolicy / interactionPolicy / taskPolicy
schemaVersion / revision / source / secretRefs[]
```

AionUi 提供表单、原始清单、变更 diff、构建预览和验证错误；AionCore 返回规范化 manifest、能力解析结果和实例 revision。运行中的 Task/Run/Lease/Receipt/Event 仍由 AionCore 持有，符合本项目已接受的 [`0001-aioncore-owns-team-work-state.md`](../../adr/0001-aioncore-owns-team-work-state.md)，不得把 JiuwenSwarm 的本地 TeamDB/JSON 模型搬进 Renderer。

## 2. Skill：安装、检索、编排、创建和演进

### 2.1 统一 Skill 生命周期

`SkillManager` 把内置、本地、SkillNet、ClawHub 和 Team Skills Hub 放进一个管理面，工作区有独立 Skill 目录和 `skills_state.json`；列表时会注册未登记的本地 Skill，并支持安装、卸载、启停、检索索引、图、演进记录和异步安装任务。源码见 [`skill_manager.py#L415-L509`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/server/runtime/skill/skill_manager.py#L415-L509) 及 [`skill_manager.py#L960-L1159`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/server/runtime/skill/skill_manager.py#L960-L1159)。**状态：已实现。**

值得直接借鉴：

- **来源身份**：不能只用 Skill 名称判断安装状态；需要 canonical source/origin/version/content fingerprint；
- **状态分离**：已安装、用户禁用、执行禁用、索引新鲜度和运行时已重载是不同状态；
- **异步安装**：安装返回 job id，前端轮询 status；完成钩子触发 Agent reload，避免长下载阻塞请求；
- **安全边界**：名称/path 校验、下载 host allowlist、安全解压和敏感错误裁剪集中处理，而不是每个市场入口各写一套；相关实现位于 [`skill_manager.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/server/runtime/skill/skill_manager.py)；
- **多源搜索**：统一结果后使用 reciprocal-rank fusion 合并不同来源，保留 source 状态和失败详情。**状态：已实现。**

当前缺口也很典型：同名多来源 Skill 的 UI 投影仍可能按 `name` 去重或使用重复 React key，正是 Open Issue [#2659](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2659) 的高概率根因；本地导入是复制快照，外部源变更不能显式刷新，见 [#2031](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2031)。因此 AionUi 的 Skill identity 不应退化成名称字符串。

### 2.2 Symphony：可解释检索和运行反馈

Symphony 先构建 Skill inventory fingerprint、树索引和 catalog，再做候选召回与编排；索引发布带备份/恢复，运行后从持久会话提取实际选中的 Skill、边和成功/失败信号，形成动态 overlay。源码见 [`index_service.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/symphony/skill_retrieval/index_service.py)、[`retrieve_service.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/symphony/skill_retrieval/retrieve_service.py)、[`evolution/store.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/symphony/evolution/store.py)、[`session_consumer.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/symphony/evolution/session_consumer.py) 和 [`service.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/symphony/evolution/service.py)。**状态：已实现。**

AionUi 值得展示的不是复杂图本身，而是一次选择的解释：候选来源、匹配特征、最终选中、被排除原因、调用结果、失败归因和索引 revision。动态权重更新应作为离线建议或需审核的 overlay，不能静默改变生产 Agent。

### 2.3 SkillDev：确定性创建流程

SkillDev 没有把“创建 Skill”留给一段自由聊天，而是定义 `INIT → PLAN → PLAN_CONFIRM → GENERATE → VALIDATE → TEST_DESIGN → TEST_RUN → EVALUATE → REVIEW → IMPROVE → PACKAGE → DESC_OPTIMIZE_CONFIRM → DESC_OPTIMIZE → COMPLETED` 状态机；支持 checkpoint、suspension point、Todo、artifact 和恢复。见 [`skilldev/DESIGN.md`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md)。**状态：已实现。**

这是 AionUi “Skill Builder” 最值得抄的部分：后端状态机驱动步骤，前端只渲染当前阶段、待确认输入、测试结果和产物；刷新或换端后按 checkpoint 恢复。应补充权限声明、依赖/SBOM、secret 引用、来源签名和发布审批，不能只验证 `SKILL.md` 格式。

### 2.4 自演进

官方文档描述模型从工具失败、用户纠正和运行轨迹提出 Skill 演进，[`Skill自演进.md`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md)；当前仓库也有 evolution store、reviewer feedback 和 rails。**状态：基础链路已实现，产品级自动采用仍应视为受控能力。**

AionUi 只建议迁移“生成候选 patch → 测试 → 人工 review → 显式发布 → 可回滚”的流程，不建议自动覆盖已安装 Skill。Skill 的多版本和回退仍是开放需求 [#2533](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2533)，说明当前版本治理还未闭环。

## 3. MCP：从配置文件升级为能力控制面

### 已实现能力

官方文档支持 `stdio`、`sse`、`streamable-http` 和 `/mcp list|reload|enable|disable`，见 [`MCP配置.md`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/docs/zh/MCP%E9%85%8D%E7%BD%AE.md)。当前源码已经具备：

- 过滤 disabled entry，校验 transport/name，规范化 stdio/HTTP 配置；
- HTTP MCP 启动前做廉价 TCP preflight，避免失败连接遗留异步任务；
- server id 由 scope 和配置稳定生成，Team 使用独立 scope；
- TUI 支持 add/update/enable/disable/remove/reload；服务端响应对敏感字段做遮蔽。

证据见 [`common/mcp_config.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/common/mcp_config.py)、[`mcp.ts`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/mcp.ts) 和 [`agent_ws_server.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/server/agent_ws_server.py)。**状态：基础 CRUD/重载已实现。**

### 尚未闭环

“预制/自定义 MCP 浏览、一键 connect/disconnect、enable/disable、CLI OAuth、trust、实时 status、工具和绑定 Skill 自动注入”仍在 [#2184](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2184) 和大型 WIP PR [#2574](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2574) 中。**状态：规划中/活跃 PR，不能把 Issue 文案当成当前能力。**

Team 模式外部知识库 MCP 失效和并行问题见 [#1272](https://github.com/openJiuwen-ai/jiuwenswarm/issues/1272)；维护者已要求 reporter 补版本、接入方式和日志，因此当前不能确认普遍根因。**状态：未解决但证据不足。**

### AionUi 迁移建议

MCP 页面应围绕资源状态而不是 JSON 编辑：

```text
catalog/custom → validate → secret binding → connect → discover tools
               → enable/disable → health/reload → disconnect
```

每个 server 展示 config revision、transport、作用域、连接/健康状态、工具清单、最近错误、上次验证时间和使用它的 Agent；secret 只保存引用，Renderer 不回显值。连接成功不等于能力可用，必须展示 tool discovery 和一次受控 smoke test 的结果。MCP 变更由 AionCore 执行并返回 receipt，AionUi 不直接拉起 stdio 子进程。

## 4. 知识库与记忆

### 4.1 JiuwenSwarm 内建 Wiki 不是完整 RAG 产品

`LLMWiki` 为每个知识库创建 `schema.md`、`AGENT.md`、`wiki/index.md` 和 append-only `wiki/log.md`；导入按 SHA-256 去重，把来源复制成不可变文件，再由专用 Agent 生成交叉链接页面；查询还能把 insight 写回 Wiki，lint 会检查/修复链接。见 [`wiki_tools.py#L184-L351`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L184-L351) 和 [`wiki_tools.py#L404-L521`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L404-L521)。**状态：已实现，但属于 LLM 维护的 Markdown Wiki。**

可抄：不可变来源、hash 去重、schema、索引、追加日志、专用维护 Agent、链接 lint。不要抄：查询默认写回、缺少 source span/citation 的答案、把生成页面当事实真源。AionCore 应持有 document/corpus/chunk/citation id；查询默认只读，洞察写回必须成为有来源、可审核的独立提案。

### 4.2 本地记忆

JiuwenSwarm 文档定义 builtin/external/both/none、多种外部 provider、Markdown `MEMORY.md`/`USER.md`/daily memory、Dreaming 后台巩固和 BM25+vector 混合检索，见 [`记忆.md`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/docs/zh/%E8%AE%B0%E5%BF%86.md)。源码中的 `MemoryIndexManager` 使用 SQLite WAL、FTS5、向量和 embedding cache，在搜索前同步 dirty 文件并合并关键词/向量结果；见 [`memory/manager.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/harness/common/memory/manager.py)。**状态：已实现。**

后台自动提取使用受限子 Agent：只允许写 memory 目录，其他路径只读，并避免与主 Agent 同轮重复写，见 [`auto_memory/extraction_runner.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py) 和 [`tool_restriction_rail.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py)。执行时敏感信息过滤不会记录被检查的值，见 [`memory/forbidden.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/harness/common/memory/forbidden.py)。**状态：已实现。**

风险：过滤可关闭；自动提取和 query-write 会改变长期状态；Open Issue [#2596](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2596) 和 [#2661](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2661) 证明“写成功”不等于新会话能召回。AionUi 应显示每条记忆的来源会话、提取原因、scope、revision、写入者和可删除/纠正入口；AionCore 负责索引刷新回执，避免 UI 只显示“已写入”。

### 4.3 agent-memory 和 DeepSearch

JiuwenSwarm 配置已提供 `jiuwen` memory provider 的 server/sdk 两种模式，并明确 SDK 需要另装 `JiuwenMemory`，见 [`resources/config.yaml#L196-L225`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/resources/config.yaml#L196-L225)。因此 `agent-memory` 是**可选直接集成**，不是主仓硬依赖。

`agent-memory` 提供 L0 原始信息、L1 摘要、L2 结构化记忆、L3 用户画像，Dreaming、MemoryTurbo、图记忆、冲突检测、多存储后端、迁移和 AES-256-GCM；但 README 明确图记忆尚未接入 `LongTermMemory.add_messages` 主流程。见 [`agent-memory README.zh.md#L17-L43`](https://github.com/openJiuwen-ai/agent-memory/blob/600432b55e480bec5948ee40089884ccf15a7c5d/README.zh.md#L17-L43) 和 [`#L263-L273`](https://github.com/openJiuwen-ai/agent-memory/blob/600432b55e480bec5948ee40089884ccf15a7c5d/README.zh.md#L263-L273)。**状态：相邻仓库已实现，JiuwenSwarm 可选集成。**

DeepSearch 支持关键词、向量、图和融合检索，本地知识库与网页融合，并把引用预览/跳转和观点溯源作为输出能力，见 [`deepsearch README_zh.md#L17-L32`](https://github.com/openJiuwen-ai/deepsearch/blob/62aa0e3718d83806aa42c4d89dfe33c2c3a11db0/README_zh.md#L17-L32) 和 [`#L38-L48`](https://github.com/openJiuwen-ai/deepsearch/blob/62aa0e3718d83806aa42c4d89dfe33c2c3a11db0/README_zh.md#L38-L48)。JiuwenSwarm 内置的是一份安装并调用 DeepSearch 包的 Skill，[`openJiuwen-DeepSearch/SKILL.md`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/SKILL.md)，不是主运行时依赖。**状态：可选 Skill 集成。**

## 5. 任务、待办和 Team Work

### 三种模型要分开

1. **Agent 执行计划**：通过 `todo_create/list/get/modify` 驱动当前任务分解和进度；Web 端按 session 投影 Todo，刷新时会保留本地 `in_progress` 计时。见 [`todoStore.ts`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/stores/todoStore.ts) 和 [`TodoList`](https://github.com/openJiuwen-ai/jiuwenswarm/tree/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/TodoList)。**状态：已实现。**
2. **用户个人待办**：`user_todo_tool.py` 明确声明不是 Agent 内部任务规划，支持 status/priority/due/remind 和 CRUD/search，按 channel 落在工作区 Markdown。见 [`user_todo_tool.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py)。**状态：已实现。**
3. **Team 任务**：任务面板展示任务、依赖、成员、Skill/File 资源、列表/看板和进度，另有成员抽屉和 Team 事件聚合。见 [`TaskPlanningPanel.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/teamArea/TaskPlanningPanel.tsx)、[`MemberTaskDrawer`](https://github.com/openJiuwen-ai/jiuwenswarm/tree/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/MemberTaskDrawer) 和 [`TeamEventGroupDisplay.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/TeamEventGroupDisplay.tsx)。**状态：已实现。**

官方 [`任务规划.md`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/docs/zh/%E4%BB%BB%E5%8A%A1%E8%A7%84%E5%88%92.md) 还声称动态拆解、插入、用户中断和 session-isolated JSON。**状态：文档声称，具体行为分散在 agent-core 和 JiuwenSwarm 适配层。**

### 不应照搬的实现细节

- Web Todo 依赖前端合并和前缀 ID 匹配，历史上出现跨请求泄漏、恢复和最终回答折进 Todo；[#2623](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2623) 已由 [#2618](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2618)/[#2622](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2622) 修复，[#2561](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2561) 已由 [#2562](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2562) 修复。Issue 仍 Open，不代表当前仍有空缺。
- 用户待办的 Markdown 文件适合个人轻量数据，不适合并发 Team 的认领、租约、完成回执和事件排序。
- GoalBar 有 active/paused/completed/blocked UI，但源码注释显示部分后端动作仍未完整接入；见 [`GoalBar/index.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/GoalBar/index.tsx)。**状态：部分实现。**

### AionUi 迁移建议

AionCore 定义三个明确资源：`ExecutionPlan`、`PersonalTodo`、`TeamTask`。只有 TeamTask 进入既有 `Task/Run/Lease/Receipt/Event` 权威模型；ExecutionPlan 是某次 Run 的可丢弃/可重建投影；PersonalTodo 有独立权限和提醒语义。所有列表都使用完整 id、revision 和 ordered event cursor，Renderer 不根据消息文本猜测状态。

## 6. 运行过程中的交互

### 6.1 澄清问题

`InteractionPrompt` 最多分页展示四个问题，支持单选、多选、自由输入、Other 校验，并区分 Skip、Cancel、提交和答案摘要回显。见 [`InteractionPrompt.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/InteractionPrompt.tsx)。**状态：已实现。**

值得迁移的是语义而不是“四题”这个常量：每个 interaction 有 id、schema、required、回答、取消原因、过期状态和 backend receipt；恢复历史时仍能判断它已回答、已取消还是等待中。非交互通道必须声明 capability 并降级为编号回复或明确失败，不能静默等待；相关问题 [#595](https://github.com/openJiuwen-ai/jiuwenswarm/issues/595) 和 capability-aware 活跃 PR [#2636](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2636)/[#2664](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2664) 说明此处仍在演进。

### 6.2 权限与审批

`AuthorizationPrompt` 固定在输入区上方，提供 reject、always allow、session allow、allow once，支持批量问题和折叠摘要。见 [`AuthorizationPrompt.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/AuthorizationPrompt.tsx)。**状态：已实现。**

AionUi 应再增加：资源/动作/参数 diff、风险原因、policy 命中、权限 scope、有效期、审计 receipt 和“拒绝后不重试”的类型化语义。Open Issue [#2672](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2672) 暴露了当前 hook block 被模型当普通工具失败而重试的问题；只改文案不足以解决，AionCore 需要 `policy_denied`/terminal 契约。

### 6.3 工具、子任务和 Team 进度

- [`ToolGroupDisplay.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ToolGroupDisplay.tsx)：按调用分组展示状态、结果和耗时，并避免历史已完成调用重新显示为 running；
- [`HarnessProgressBar.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/HarnessProgressBar.tsx)：阶段支持 pending/running/success/failed/timeout 和扩展子阶段；
- [`SubtaskProgress.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/SubtaskProgress.tsx)：按子 Agent 展示 starting/tool_call/tool_result；
- [`TeamEventGroupDisplay.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/TeamEventGroupDisplay.tsx)：按成员聚合最近 task/todo/message/tool 活动并可下钻。

**状态：均已实现。** AionUi 可统一为 `ProcessEvent` envelope：`eventId/sequence/runId/actor/type/status/startedAt/endedAt/parentId/payloadRef/visibility`。UI 再按类型投影为卡片、时间线、看板或详情抽屉；最终回答必须是独立 `final_answer`，不能成为某个 Todo/Tool 分组的子节点。

### 6.4 A2UI

模型输出 `<a2ui-json>`，服务端解析、校验/修复，前端只渲染注册组件并把交互事件回传；validator 检查重复 key、模板路径、嵌套 template 和 image URL。见 [`A2UI.md`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/docs/zh/A2UI.md)、[`validator.py`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/server/runtime/a2ui/validator.py) 和 [`A2UIMessageContent.tsx`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx)。**状态：已实现，默认关闭。**

可迁移：版本化协议、固定组件 registry、schema 校验、错误边界、结构化 client event。不可迁移：任意 DOM/脚本、模型自定义 action 权限。Team 长流中 A2UI block 曾阻塞整个会话，[#2256](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2256) 尚 Open，说明 buffer 必须按 run/member/block 隔离，repair 不能卡住主事件流。

### 6.5 追踪和审计

官方 [`调试追踪.md`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/docs/zh/%E8%B0%83%E8%AF%95%E8%BF%BD%E8%B8%AA.md) 支持按请求或全局 dump、OpenTelemetry 和子 Agent trace。**状态：已实现基础调试追踪。** 完整结构化执行回放和操作日志仍是 [#2198](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2198) 与 [#2594](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2594) 的规划。AionUi 应优先展示结构化事件和脱敏摘要，原始 prompt/tool payload 按权限单独读取，避免“为了可观测”把 secret 和个人数据复制进日志。

## 7. openJiuwen-ai 组织内相邻仓库

| 仓库与快照                                                                                                                | 与目标主题直接相关的能力                                                                                                                                                                                                                                                                                                                                            | JiuwenSwarm 关系                                                                                                                                                                                                                | 对 AionUi 的价值                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`agent-core@939c73e`](https://github.com/openJiuwen-ai/agent-core/tree/939c73e66525f34512802706ac37db58a218a4f9)         | Agent/Workflow SDK、异步并行图、流式执行、状态保存和中断接续、工作流切换、全链路观测；见 [`README.zh.md#L7-L17`](https://github.com/openJiuwen-ai/agent-core/blob/939c73e66525f34512802706ac37db58a218a4f9/README.zh.md#L7-L17) 和 [`#L144-L165`](https://github.com/openJiuwen-ai/agent-core/blob/939c73e66525f34512802706ac37db58a218a4f9/README.zh.md#L144-L165) | **硬依赖/直接集成**：主仓 `pyproject.toml` 直接依赖 `agent-core@develop`，[证据](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/pyproject.toml#L14-L35)                             | 用于理解运行时契约；实现应落 AionCore，不把 Python runtime 搬进 AionUi                     |
| [`agent-memory@600432b`](https://github.com/openJiuwen-ai/agent-memory/tree/600432b55e480bec5948ee40089884ccf15a7c5d)     | L0–L3、Dreaming、冲突检测、图记忆、provider/storage/migration、安全加密                                                                                                                                                                                                                                                                                             | **可选直接集成**：JiuwenSwarm 有 server/sdk provider 配置，但需另装包                                                                                                                                                           | 记忆治理、scope、冲突和迁移模型值得参考；注意 README 标出的未接主流程能力                  |
| [`skillhub@d7c8745`](https://github.com/openJiuwen-ai/skillhub/tree/d7c874579cced97505ad9e0f976d1ef8344665bb)             | 自建 Skill 托管/分发、发布与版本治理、预签名下载、CLI/Web、ClawHub 兼容；见 [`README_zh.md#L9-L29`](https://github.com/openJiuwen-ai/skillhub/blob/d7c874579cced97505ad9e0f976d1ef8344665bb/README_zh.md#L9-L29)                                                                                                                                                    | **服务级集成**：JiuwenSwarm `SkillManager` 有 Team Skills Hub API，不是 Python 包依赖                                                                                                                                           | 可作为企业 Skill registry；AionUi 只做消费/治理 UI，签名、版本、下载授权由服务端处理       |
| [`agent-studio@4e01769`](https://github.com/openJiuwen-ai/agent-studio/tree/4e017694d31c007672fb3ef8faf02857ad8ad7cb)     | 低代码 Agent/Workflow、RAG 知识库、插件市场、MCP；见 [`README_zh.md#L84-L90`](https://github.com/openJiuwen-ai/agent-studio/blob/4e017694d31c007672fb3ef8faf02857ad8ad7cb/README_zh.md#L84-L90)                                                                                                                                                                     | **同组织参考，未发现 JiuwenSwarm 直接依赖**                                                                                                                                                                                     | 用于对照信息架构和编排 UX；不要引入其 Java/独立 runtime 形成第二个 AionCore                |
| [`relay@9de4597`](https://github.com/openJiuwen-ai/relay/tree/9de45970272cc6985334b14da116b9e159a7fce6)                   | 多 Agent 对话、角色/Skill/协作策略、任务规划、定时任务、状态监控；见 [`README_zh.md#L19-L21`](https://github.com/openJiuwen-ai/relay/blob/9de45970272cc6985334b14da116b9e159a7fce6/README_zh.md#L19-L21) 和 [`#L56-L98`](https://github.com/openJiuwen-ai/relay/blob/9de45970272cc6985334b14da116b9e159a7fce6/README_zh.md#L56-L98)                                 | **同组织参考，未发现 JiuwenSwarm 直接依赖**                                                                                                                                                                                     | 参考 Team 控制台、@路由和运行监控；README 声明不能替代源码验证                             |
| [`agent-protocol@b256840`](https://github.com/openJiuwen-ai/agent-protocol/tree/b25684052a7581723947474cb71f85c5f841e6a2) | MCP C++ SDK、A2A C++ SDK、Agent Registry；见 [`README_zh.md#L7-L10`](https://github.com/openJiuwen-ai/agent-protocol/blob/b25684052a7581723947474cb71f85c5f841e6a2/README_zh.md#L7-L10)                                                                                                                                                                             | **分布式 Team 外部依赖/独立部署**：官方分布式文档要求单独启动 registry，[证据](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/docs/zh/%E5%88%86%E5%B8%83%E5%BC%8FTeam.md#L244-L264) | 参考跨 Agent 协议和 registry lease；AionUi 通过 AionCore adapter，不直接对 registry 写状态 |
| [`deepsearch@62aa0e3`](https://github.com/openJiuwen-ai/deepsearch/tree/62aa0e3718d83806aa42c4d89dfe33c2c3a11db0)         | 多 Agent 研究、融合检索、引用和观点溯源                                                                                                                                                                                                                                                                                                                             | **可选 Skill 集成，不是主仓硬依赖**                                                                                                                                                                                             | 知识库引用、检索过程和研究产物展示的优先参考                                               |

## 8. 官方 Open Issue 交叉清单

### 8.1 确认仍有空缺、与本调研直接交叉

快照日期为 2026-08-11。GitHub Issue/PR 大量从 GitCode 同步，Open 状态会滞后；下表已检查 timeline、关联 PR 和当前源码，但合并前仍需再做一次 live 查重。

| Issue                                                                                                                                                                                    | 交叉领域         | 当前证据与缺口                                                                                                                                                                                                                                                                   | 建议                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [#2659 技能卡片数与统计不一致](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2659) `major`                                                                                         | Skill/UI 投影    | `installedSkillMap` 按名称归并，原始 `skills`、统计和 React `key` 又以名称/数组渲染；[源码](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/index.tsx#L693-L766)          | 先在 develop 复现同名多来源；统一 identity 和列表投影                              |
| [#2656 安装失败不显示错误码/详情](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2656) `normal`                                                                                     | Skill/过程错误   | SkillNet modal 能消费 `detail_key/detail`，但 transport/unexpected error 回退通用提示；[源码](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/features/SkillNetSearchModal/index.tsx#L433-L574) | 统一 RPC error envelope，保留安全 detail、error code、install/request id           |
| [#2031 本地 Skill 无法刷新](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2031)                                                                                                    | Skill 生命周期   | list 会重扫工作区，但不会回读已复制的外部源；[源码](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/server/runtime/skill/skill_manager.py#L461-L484)                                                                      | 显式“检测更新/重新导入”，保存 canonical path + fingerprint；不要热执行任意外部目录 |
| [#2596 写入记忆后新会话无法召回](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2596) `major`、[#2661 记不住名字](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2661) `major` | 记忆/索引/跨会话 | memory tool 写文件后没有显式 index receipt；可能是索引竞态，也可能是新会话未触发搜索；[写入源码](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/agents/harness/common/tools/memory_tools.py#L290-L358)                   | 先用跨会话测试区分“查不到”和“没调用”；写入后确定性 invalidate/refresh 并回执       |
| [#215 更换 embedding 后旧索引不重建](https://github.com/openJiuwen-ai/jiuwenswarm/issues/215) `major`                                                                                    | 知识/记忆索引    | 持久索引缺 provider/model/dimension/schema fingerprint 的兼容校验                                                                                                                                                                                                                | 保存索引 fingerprint，配置变更后标 stale、可观测重建并测试迁移                     |
| [#2490 Skill 图构建后数量/列表空](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2490)                                                                                              | Skill 检索/交互  | 前端对多种 payload 形状做兼容，仍缺稳定 contract fixture；[源码](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/web/frontend/src/components/SkillGraphPanel/index.tsx#L285-L345)                                | 保存真实 payload，统一 skill id/name/leaf count，而不是继续加 UI 兜底              |
| [#2672 Hook 阻断被当普通失败并重试](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2672)                                                                                            | 权限/过程交互    | 当前只写 `_skip_tool`/feedback，测试未验证模型不重试；[源码](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/server/hooks/user_hook_rail.py#L32-L73)                                                                      | 先与维护者确定 `policy_denied`/terminal 契约，再贯通 tool result                   |
| [#2256 Team A2UI 阻塞持久流](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2256)                                                                                                   | A2UI/Team 过程流 | A2UI buffer/finalize 以过大的请求范围工作，单成员块可能压住后续事件                                                                                                                                                                                                              | 按 run/member/block 隔离状态，repair 异步回注                                      |
| [#2198 结构化执行 trace](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2198)、[#2594 操作日志审计](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2594)                       | 追踪/审计        | 已有 debug dump/OTel，但缺用户可查的、结构化回放和操作审计                                                                                                                                                                                                                       | 先定义脱敏 event schema、保留期和访问控制，再做页面                                |
| [#2676 TUI 公网探测误杀任务](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2676)                                                                                                   | 过程状态/连接    | TUI 以公网 TCP probe 推断 WS 断线并清理 active turn；[源码](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L886-L937)                                                             | WS heartbeat/ack 才是权威；公网 probe 只能做诊断，不能终止任务                     |

### 8.2 需先协调，不能直接当空缺

- [#2184 动态 MCP](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2184) 已有大型 WIP [#2574](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2574)；`/mcp connected` 状态 [#1933](https://github.com/openJiuwen-ai/jiuwenswarm/issues/1933) 也与该 PR 生命周期模型重叠。
- [#1272 Team MCP/知识库失效](https://github.com/openJiuwen-ai/jiuwenswarm/issues/1272) 的维护者回复仍在索要版本、接入方式和日志；先补复现证据。
- [#2665 Code Graph MCP](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2665) 明确与 [`agent-core#462`](https://github.com/openJiuwen-ai/agent-core/issues/462) 交叉，不是 JiuwenSwarm 单仓小修。
- [#2533 Skill 多版本](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2533) 需要先定义版本来源、回滚失败和不同市场兼容；直接大改接纳概率低。
- [#2037 Task 优先级队列](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2037) 提议的落点与当前代码结构不完全一致，需先对齐 Task/Message schema、aging 和 HOTS 控制语义。
- [#2681 Skill 显示思考但不执行](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2681) 缺版本/日志/最小复现，timeline 又关联 [#2679](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2679)，先确认归属。

### 8.3 已有活跃 PR 或已修复，不要重复

| 条目                                                                                          | 实际状态                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#2631 TUI tool progress/rewind](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2631)    | 活跃 PR [#2632](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2632)                                                                                                                                 |
| [#2629 capability-aware never-drop](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2629) | 活跃 stacked PR [#2636](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2636)、[#2664](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2664)                                                        |
| [#2450 拆出 Ascend Skills](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2450)          | 活跃 PR [#2451](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2451)                                                                                                                                 |
| [#1787 缓存 Skill tree YAML](https://github.com/openJiuwen-ai/jiuwenswarm/issues/1787)        | 活跃 PR [#1847](https://github.com/openJiuwen-ai/jiuwenswarm/pull/1847)，且维护者[明确认为 YAML 不是瓶颈](https://github.com/openJiuwen-ai/jiuwenswarm/issues/1787#issuecomment-5115052249)；不建议投入 |
| [#2570 Skill 图错误显示成功](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2570)        | 已合并 [#2571](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2571)                                                                                                                                  |
| [#2623 coding Todo/plan](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2623)            | 已合并 [#2618](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2618)、[#2622](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2622)                                                                 |
| [#2561 最终回答折进 Todo](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2561)           | 已合并 [#2562](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2562)                                                                                                                                  |
| [#1459 MCP disconnect 残留进程](https://github.com/openJiuwen-ai/jiuwenswarm/issues/1459)     | 已合并 [#1904](https://github.com/openJiuwen-ai/jiuwenswarm/pull/1904)                                                                                                                                  |
| [#1218 企业 Skill 生命周期](https://github.com/openJiuwen-ai/jiuwenswarm/issues/1218)         | 已合并 [#2400](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2400)                                                                                                                                  |

## 9. PR 候选与接纳概率

以下概率是基于问题边界、复现、当前源码、占坑情况、近期 PR 和贡献规则的**推断，不是维护者承诺**。

官方要求在 GitCode 提交、目标 `develop`，PR 写 what/why、关联 Issue、测试方法，UI 附截图；中英文文档同步，自动检查后需两位 Committer 通过。见官方中文 [`贡献指南.md#L36-L90`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/docs/zh/%E8%B4%A1%E7%8C%AE%E6%8C%87%E5%8D%97.md#L36-L90) 和 [`#L121-L178`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/91c9f367a8308ac95f9b688905fa76f3eabd55e7/docs/zh/%E8%B4%A1%E7%8C%AE%E6%8C%87%E5%8D%97.md#L121-L178)。GitHub 是同步镜像，不能只在 GitHub 看 Open 状态或直接把 GitHub 当主贡献入口；真正投稿前还要在 GitCode 再核对 Issue/PR 占用情况。

| 排名 | 候选                                                                                                | 概率 | 最小可接纳范围                                                                        | 必要验证                                                                   |
| ---: | --------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
|    1 | [#2659 Skill 同名多来源的列表/计数一致性](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2659) | 高   | 抽纯函数按 canonical identity/origin 和来源优先级生成唯一投影；统计和卡片使用同一投影 | develop 复现；同名多来源、搜索、启停组合单测；UI 前后截图                  |
|    2 | [#2676 TUI 公网探测误杀 active turn](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2676)      | 高   | 以 WS connection/heartbeat 为终止权威；公网 probe 只给诊断                            | fake timer、受限网络、长工具、真 WS 断线测试                               |
|    3 | [#2656 Skill 安装错误详情贯通](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2656)            | 中高 | 统一 Web/RPC error normalize，安全保留 code/detail/install id                         | 先捕获真实失败 payload；同步失败、异步 failed、transport exception UI 测试 |
|    4 | [#2596 跨会话记忆索引刷新](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2596)                | 中高 | 先加失败测试；若确认索引竞态，写/改成功后做确定性 invalidate/refresh                  | 区分未调用 search 与索引查不到；并发写、失败回滚、跨会话测试               |
|    5 | [#2672 Hook policy-denied 语义](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2672)           | 中高 | 先获维护者确认 terminal/result contract，再做最小贯通                                 | 阻断后不换工具、不重复调用、审计中保留拒绝原因                             |
|    6 | [#2031 本地 Skill 显式刷新](https://github.com/openJiuwen-ai/jiuwenswarm/issues/2031)               | 中   | canonical source path + fingerprint + 显式检测/重新导入，不做任意目录热执行           | 路径穿越、源删除、内容冲突、reload、Windows path 测试                      |
|    7 | [#215 embedding fingerprint 和重建](https://github.com/openJiuwen-ai/jiuwenswarm/issues/215)        | 中   | index metadata 记录 provider/model/dimension/schema；不匹配标 stale                   | 旧索引迁移、重建失败、维度变化和不中断旧可用索引测试                       |

判断依据：近期合并的 [#2571](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2571)、[#2622](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2622)、[#2562](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2562)、[#2035](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2035) 和 [#1904](https://github.com/openJiuwen-ai/jiuwenswarm/pull/1904) 都是单一问题、明确落点和自动测试的修复；外部贡献者的 [#2556](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2556)、[#2558](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2558) 和 [#2405](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2405) 已合并，说明并非只接纳内部提交。反面信号是有冲突/CI 问题的 [#2391](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2391) 和 [#2374](https://github.com/openJiuwen-ai/jiuwenswarm/pull/2374)，以及维护者明确否定价值的 #1787；因此“小、可复现、带测试、及时 rebase”比大功能提案更容易进入。

## 10. AionUi 官方 Open Issue 交叉与上游投稿判断

本节另行刷新了 `iOfficeAI/AionUi` 官方索引。快照时间为 **2026-08-11T04:10:20Z**：586 个 Open Issue、176 个 Open PR。以下判断同时核对了 Issue 正文/维护者回复、最接近的 Open/merged/closed PR 和 `upstream/main@114f97d` 当前代码。Issue 保持 Open 不代表功能仍缺失。

### 10.1 优先候选

| 排名 | Issue                                                                              | 当前代码证据                                                                                                                                                                                                                                                                                                          | 判断与接纳可能性                                                                                                                                                                     | 单一下一步                                                                                                               |
| ---: | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
|    1 | [#2745 新建会话直接使用 `/skill`](https://github.com/iOfficeAI/AionUi/issues/2745) | [`useSlashCommands`](https://github.com/iOfficeAI/AionUi/blob/114f97de58c4d0efd92a0fcb1ca5909166eefe37/packages/desktop/src/renderer/hooks/chat/useSlashCommands.ts#L49-L67) 仍在没有 `conversation_id` 时清空命令；未找到同题 Open PR                                                                                | **提交候选，81/100，中高**。需求独立、落点集中；不确定性是新建页已有 Skill 选择菜单，维护者可能把 `/` 视为便利而非缺陷                                                               | 先做一个只合并本地 Skill 命令和运行时命令的原型，明确同名优先级，并准备 Guid 页截图和单元/E2E                            |
|    2 | [#3268 项目会话无法加载 Skill](https://github.com/iOfficeAI/AionUi/issues/3268)    | 维护者已确认项目上下文与普通会话路径不同；前端只有 [`/api/skills/materialize-for-agent`](https://github.com/iOfficeAI/AionUi/blob/114f97de58c4d0efd92a0fcb1ca5909166eefe37/packages/desktop/src/common/adapter/ipcBridge.ts#L795-L810) 契约，真正物化在 AionCore                                                      | **高价值调查；若根因在 AionUi 契约层则 84/100、高，否则不能提交 AionUi-only PR**                                                                                                     | 在最新官方 build 用 normal/project 两条路径复现并比较 conversation snapshot、materialize request/receipt；先确定仓库归属 |
|    3 | [#715 View Steps 渐进披露](https://github.com/iOfficeAI/AionUi/issues/715)         | 当前代码已做到“运行中展开、结束后折叠”和逐项详情，[`MessageToolGroupSummary`](https://github.com/iOfficeAI/AionUi/blob/114f97de58c4d0efd92a0fcb1ca5909166eefe37/packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx#L143-L170) 仍缺稳定的语义摘要且有硬编码 `View Steps` | **抽窄后提交，76/100，中**。完整 Issue 已部分覆盖；只做“可本地化的简短动作摘要 + 保留原始详情”更易审                                                                                 | 先在 Issue 说明已覆盖部分，确认剩余范围，再提交小 PR 和前后录屏                                                          |
|    4 | [#3714 权限模式未持久化](https://github.com/iOfficeAI/AionUi/issues/3714)          | Issue 给出具体 DB/初始化根因；但当前已有 assistant preference/snapshot E2E，且 Guid 的持久化策略仍按 `hasSelectedAssistant` 分支，[代码](https://github.com/iOfficeAI/AionUi/blob/114f97de58c4d0efd92a0fcb1ca5909166eefe37/packages/desktop/src/renderer/pages/guid/GuidPage.tsx#L476-L501)                           | **只在最新版本仍可复现时提交；条件成立则约 85/100、高**。已有 merged [#991](https://github.com/iOfficeAI/AionUi/pull/991) 做过旧路径的 mode persistence，不能只按 Issue 旧版本改代码 | 先补一个“内置 preset Agent + 中途切换 + 重启/新会话”的失败 E2E；测试不红就停止                                           |

### 10.2 需求真实，但必须跨 AionCore 或先对齐协议

| Issue                                                                                       | 交叉点                                           | 为什么不能直接做 AionUi-only PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#3919 stdio MCP 合法 schema 被拒](https://github.com/iOfficeAI/AionUi/issues/3919)         | Jiuwen MCP 预检/工具发现、AionUi MCP 契约        | 复现很完整且无同题 PR；但当前 UI 的 [`IMcpTool`](https://github.com/iOfficeAI/AionUi/blob/114f97de58c4d0efd92a0fcb1ca5909166eefe37/packages/desktop/src/common/config/storage.ts#L636-L641) 和保存映射只保留 `input_schema/_meta`，[映射](https://github.com/iOfficeAI/AionUi/blob/114f97de58c4d0efd92a0fcb1ca5909166eefe37/packages/desktop/src/renderer/hooks/mcp/useMcpConnection.ts#L190-L200)；Issue 的 `schema_error` 更可能先发生在 AionCore DTO/SDK 路径。应先定位 schema validator，再决定是否需要 AionCore + AionUi 配对变更。 |
| [#2542 ACP Elicitation](https://github.com/iOfficeAI/AionUi/issues/2542)                    | Jiuwen `ask_user_question`、结构化问答           | AionUi 已有通用 structured question card，但 ACP request/response 的接入点在运行时。先确认当前 ACP 规范版本和 AionCore 支持，再把 Elicitation 映射到既有问答 UI；不要新造第二套问答状态。                                                                                                                                                                                                                                                                                                                                                |
| [#3136 `team_task_list` 使子 Agent 崩溃](https://github.com/iOfficeAI/AionUi/issues/3136)   | Jiuwen Todo/Team 状态、Agent 工具                | 维护者确认是 Bug，但官方 AionUi 当前代码没有该工具实现字符串；任务工具和运行时崩溃路径属于 AionCore/Team runtime。AionUi 可补错误投影，不能伪修根因。                                                                                                                                                                                                                                                                                                                                                                                    |
| [#3832 Team WebSocket backpressure 丢消息](https://github.com/iOfficeAI/AionUi/issues/3832) | Jiuwen capability-aware never-drop、结构化过程流 | 根因指向 AionCore realtime channel buffer。正确修复需要事件优先级、背压/重放和 snapshot 恢复；单纯把 Renderer spinner 清掉或增大 UI 缓冲不是完成。                                                                                                                                                                                                                                                                                                                                                                                       |

### 10.3 大方向值得吸收，但先讨论或等待负责人

- [#3216 三层共享记忆](https://github.com/iOfficeAI/AionUi/issues/3216)：维护者已接纳为产品需求，且已有贡献者声明在开发。Jiuwen `agent-memory`、Markdown memory 和 index receipt 可作为设计输入；不要直接提交一个大而全实现。建议先把 `global/project/session` scope、来源、纠正/删除、敏感过滤和 AionCore 权威写成可评审契约。
- [#3924 Agent Plugins 按 Assistant 分配](https://github.com/iOfficeAI/AionUi/issues/3924)：与 Jiuwen 的 Agent 能力装配最接近，但 Issue 已分配维护者且仍 `needs-triage`。适合先贡献 manifest/schema 和兼容性设计，不适合直接铺注册表、安装器、Skill/MCP 合并和 UI 的大 PR。
- [#3931 Persistent Teams + Managed Work Board](https://github.com/iOfficeAI/AionUi/issues/3931)：已分配两位维护者，属于产品/架构级项目。当前分支已有“AionCore 持有 Team Work 状态”的 ADR 和投影实现；能抄 Jiuwen 的活动时间线、成员进度、人工阻塞交互，不能复制本地 TeamDB 成为第二权威。

### 10.4 已占坑、已覆盖或状态漂移：不要重复投稿

| Issue                                                                              | 实际状态                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#3119 全局默认 MCP](https://github.com/iOfficeAI/AionUi/issues/3119)              | 已有 Open [#3835](https://github.com/iOfficeAI/AionUi/pull/3835)，所有已运行 CI 为 green，等待 review；不要重复                                                                       |
| [#2561 子 Agent 导航](https://github.com/iOfficeAI/AionUi/issues/2561)             | 已有 Open [#2593](https://github.com/iOfficeAI/AionUi/pull/2593)，CI green；可以 review/补证据，不要另开实现                                                                          |
| [#2704 按 Agent 组装 MCP](https://github.com/iOfficeAI/AionUi/issues/2704)         | 维护者明确回复 2.1.25 已完成，当前 Assistant 默认 Skill/MCP 选择也已存在                                                                                                              |
| [#3328 新会话 Skill 不保存](https://github.com/iOfficeAI/AionUi/issues/3328)       | 维护者明确回复已在 2.1.24+ 修复，并说明 `extra.skills` snapshot/materialize 链路；只接受最新版本新复现                                                                                |
| [#1102 ACP 上下文用量](https://github.com/iOfficeAI/AionUi/issues/1102)            | Issue 评论指向实现 PR #1207，当前代码已有 `ContextUsageIndicator`；Open 状态是漂移                                                                                                    |
| [#1492 Skills Hub 详情/i18n/暗色](https://github.com/iOfficeAI/AionUi/issues/1492) | 详情页、文件浏览和相关样式已被 [#3604](https://github.com/iOfficeAI/AionUi/pull/3604)、[#3683](https://github.com/iOfficeAI/AionUi/pull/3683) 等后续 PR 覆盖；不能按旧 Issue 整包重做 |

**AionUi 最佳单一下一步**：先认领/复现 [#2745](https://github.com/iOfficeAI/AionUi/issues/2745)。它是当前证据最完整、最接近纯 Renderer、没有同题 Open PR、又能直接吸收 Jiuwen “命令发现与运行时命令合并”体验的原子改动。若更偏底层可靠性，则先做 #3268 的双路径复现，但在定位仓库归属前不要写修复。

## 11. 面向 AionUi 的落地清单

### 第一阶段：先统一契约

- [ ] AionCore 定义版本化 `AgentManifest`、规范化结果和构建 preview；AionUi 支持 diff/validation，不保存 secret 值。
- [ ] 定义 `CapabilityBinding`：Skill、MCP、Knowledge、Memory 都有 canonical id、source、revision、scope、enabled、health。
- [ ] 定义 `ProcessEvent` envelope 和事件类型：interaction、authorization、plan、todo、tool、subtask、team activity、artifact、final answer、error。
- [ ] 明确 `ExecutionPlan`、`PersonalTodo`、`TeamTask` 三域，TeamTask 复用 AionCore 既有 Task/Run/Lease/Receipt/Event。
- [ ] 所有变更命令带 expected revision/idempotency key，所有运行状态以 AionCore snapshot + ordered events 恢复。

### 第二阶段：做可控管理面

- [ ] Skill：多来源搜索、安装 job、来源身份、版本/fingerprint、启停、reload 状态、调用解释、失败详情。
- [ ] MCP：catalog/custom、validate、secret ref、connect/discover/enable/health/reload/disconnect、Agent 绑定和 scope。
- [ ] Knowledge：immutable source、hash、chunk/citation、索引 fingerprint、只读 query；洞察写回走审核提案。
- [ ] Memory：来源、scope、提取原因、敏感过滤、索引 receipt、纠正/删除、跨会话召回验证。
- [ ] 过程 UI：权限、澄清问题、计划审批、工具组、子任务、Team 时间线和最终回答使用独立槽位。

### 第三阶段：增强但不越权

- [ ] SkillDev 状态机、checkpoint、测试/评估和发布审批。
- [ ] 固定组件 registry 的 A2UI，按 run/member/block 隔离并异步 repair。
- [ ] Skill 选择 trace、离线反馈 overlay 和人工批准后的权重/版本发布。
- [ ] 脱敏的执行回放和操作审计；原始 payload 独立授权访问。

验收时应特别验证：刷新/换端恢复、并发 Agent、断线重连、拒绝后不重试、失败不伪装成功、同名多来源、索引模型变更、Team 长流中局部 UI/工具失败不阻塞其他事件，以及最终回答永远不被 Todo/Tool 折叠吞掉。
