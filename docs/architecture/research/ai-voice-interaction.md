# AI 语音多轮业务交互方案调研

> 调研日期：2026-08-06
>
> 范围：用户在桌面端、WebUI 或移动端持续与 AI 进行双向语音交互，并通过多轮澄清、查询、确认和工具调用完成业务；不包含 PSTN、SIP、电话号码或呼叫中心。

## 结论

如果目标是做出接近豆包的自然语音体验，同时可靠完成业务，推荐使用“实时语音体验层 + 结构化业务执行层”的混合架构：

```text
AionUi（麦克风、扬声器、状态和业务卡片）
  → WebRTC
  → Voice Session Runtime（LiveKit Agents 优先，Pipecat 备选）
      ├─ 端到端实时语音模型：自然对话、情绪、打断
      ├─ 级联链路：流式 ASR → LLM → 流式 TTS，作为可控或降级路径
      └─ 轮次检测、回声消除、会话恢复、指标
  → AionCore 业务 Agent / 显式流程状态机
  → MCP、业务 API、知识库和审批确认
```

生产首选：

1. 用 **LiveKit Agents + WebRTC** 解决双向音频、打断、轮次检测、跨端 SDK 和运行时伸缩；
2. 首期接入豆包端到端实时语音或同等级商业 Speech-to-Speech 模型，快速达到自然度目标；
3. 把收集字段、步骤推进、权限、工具调用、结果校验和最终确认放在 AionCore 的结构化业务流程中；
4. 保留 `流式 ASR → 文本 LLM/工具 → 流式 TTS` 路径，用于强审计场景、复杂业务和供应商降级；
5. 开源端到端语音模型先作为并行实验，不直接承担唯一的生产业务执行链路。

字节 Seed 将豆包新一代体验描述为原生全双工：模型可边说边听，并区分用户真正打断、附和和环境干扰；这说明“像豆包”的关键不只是 TTS 声音好听，而是持续监听、轮次控制和干扰抑制共同作用。[Seed Full-Duplex Speech LLM](https://seed.bytedance.com/zh/blog/introducing-seed-full-duplex-speech-llm-attentive-listening-robust-interference-suppression-enabling-more-natural-interaction)

## 成功标准

### 交互体验

- 用户无需每轮点击开始和停止，可以持续说话；
- 用户开口后 AI 能在 300 ms 内停止播音；
- AI 能区分真正打断和“嗯、对、好的”等附和；
- 用户说半句话、停顿思考或中途改口时，不会过早提交错误意图；
- AI 执行业务工具期间给出简短、可打断的进度反馈；
- 网络短暂抖动或会话重连不会丢失已确认的业务状态。

### 业务可靠性

- 对姓名、日期、金额、地址、对象等关键字段维护结构化状态，而不是只依赖对话历史；
- 业务写操作必须经历“收集 → 校验 → 复述确认 → 执行 → 核验结果”；
- 每个工具具有明确输入模式、超时、幂等键、权限和失败返回；
- 用户可以返回上一步纠正，状态机不会因自然语言改口而错乱；
- 语音转写、工具参数、确认内容和真实执行结果能形成同一条审计链。

### 建议指标

| 指标                           | PoC 门槛 | 生产目标 |
| ------------------------------ | -------: | -------: |
| 用户话轮结束到 AI 首包音频 P95 |  < 1.5 s |  < 1.0 s |
| 用户打断到停止播音 P95         | < 500 ms | < 300 ms |
| 轮次误切分率                   |     < 8% |     < 3% |
| 关键字段一次提取正确率         |    > 90% |    > 97% |
| 已确认业务执行正确率           |    > 98% |  > 99.9% |
| 弱网重连后的业务状态恢复率     |    > 95% |    > 99% |

指标需要按阶段拆分为 VAD、end-of-turn、ASR final、LLM 首 token、TTS 首音频和端到端延迟。LiveKit 已提供逐轮指标和语音会话事件，可直接用于埋点。[LiveKit Agents](https://docs.livekit.io/agents/)

## 为什么不是继续扩展当前 STT 输入

AionUi 当前的 `useSpeechInput`、`pcmRecorder` 和 `/api/stt/stream` 主要解决“录一段话并插入聊天输入框”：

- Renderer 通过 `AudioWorklet` 采集 24 kHz PCM；
- 服务端只回传 partial/final transcript；
- 用户停止录音后结束本轮；
- 没有 AI 音频下行、WebRTC jitter buffer、回声消除、barge-in 或持续会话协议。

这些代码可以复用设备权限、波形 UI 和 STT 降级经验，但不应在现有 `/api/stt/stream` 上继续叠加完整双工协议。持续语音 Agent 应使用独立的 Voice Session 契约。

## 推荐架构

### 1. AionUi：体验与展示层

- 麦克风和扬声器设备选择、授权和静音；
- `listening / thinking / speaking / tool-running / confirmation / reconnecting / error` 状态；
- 实时转写、可视化波形、业务字段卡片和确认按钮；
- 允许键盘、触控与语音随时混用；
- Renderer 只使用浏览器/React 能力，通过现有 adapter 取得会话令牌和业务事件。

音频优先通过 WebRTC 传输，而不是自行用 WebSocket 发送裸 PCM。WebRTC 已包含 Opus、抖动缓冲、拥塞控制和浏览器音频处理；LiveKit 的前端与 Agent 之间即使用 WebRTC，Agent 再通过 HTTP/WebSocket 连接业务后端。[LiveKit 架构](https://docs.livekit.io/agents/)

### 2. Voice Session Runtime：实时媒体与对话控制

建议把以下能力放在 AionCore 或独立 Voice Service，而不是 Electron Main：

- WebRTC 房间、令牌和会话生命周期；
- 音频输入输出、VAD、语义 end-of-turn、barge-in；
- 模型连接、ASR/TTS/S2S 适配、取消生成和音频队列清理；
- 工具调用期间的短反馈、超时和恢复；
- 转写、逐轮延迟、错误、成本和模型版本观测。

LiveKit 的 turn detector 会在 VAD 之外使用语音信号判断话轮是否结束；仅靠静音阈值容易在用户思考停顿时抢话。[LiveKit turn detector](https://docs.livekit.io/agents/logic/turns/turn-detector/)

### 3. AionCore：业务流程所有者

语音模型可以理解和表达，但不能成为业务真实状态的唯一所有者。建议维护：

```ts
type VoiceBusinessSession = {
  sessionId: string;
  intent: string | null;
  stage: string;
  slots: Record<string, { value: unknown; sourceText: string; confirmed: boolean }>;
  pendingAction: { tool: string; args: unknown; idempotencyKey: string } | null;
  completedActions: Array<{ tool: string; resultRef: string }>;
  revision: number;
};
```

简单流程可用单 Agent + tools；需要收集多个字段、允许回退的流程使用 task group 或显式状态机；不同权限或角色才切换 Agent。LiveKit 的 workflow 文档同样将 Agent、Task、Tool 和 TaskGroup 分开，其中 TaskGroup 支持按序执行并返回前一步纠正。[LiveKit workflows](https://docs.livekit.io/agents/logic/workflows/)

每次写操作建议执行：

1. 模型提出结构化候选参数；
2. AionCore 根据业务规则验证和补全；
3. AionUi 同步显示即将执行的内容；
4. AI 用自然语言简短复述，用户语音或按钮确认；
5. AionCore 使用幂等键执行工具；
6. 读取真实返回结果，再由 AI 播报，不允许根据预测结果提前宣称成功。

## 模型路线

### 路线 A：商业端到端实时语音

适合追求豆包式自然感的第一阶段。模型直接处理音频并生成音频，更能保留语气、情绪、停顿和重叠说话。Gemini Live 等同类接口也公开支持 barge-in、音频转写和 function calling，说明端到端语音与业务工具可以组合，但工具结果仍需应用侧执行和返回。[Gemini Live](https://ai.google.dev/gemini-api/docs/live-api) [Live API 工具调用](https://ai.google.dev/gemini-api/docs/live-api/tools)

限制：供应商绑定、调试难度和语音上下文成本更高；涉及金额、权限和写操作时必须把关键字段映射回结构化状态。

### 路线 B：流式 ASR → LLM/Tools → 流式 TTS

适合流程明确、可审计要求高的业务。优点是每一步可替换、可观察，工具调用和文本规则成熟；缺点是级联延迟更高，情绪、语调和重叠说话更不自然。

中文自建候选：

- ASR：FunASR / SenseVoice；
- LLM：现有 AionCore Agent 和业务工具；
- TTS：Qwen3-TTS / CosyVoice；
- VAD：Silero VAD（MIT）或框架内置 VAD。

[Hugging Face Speech-to-Speech](https://github.com/huggingface/speech-to-speech) 已提供 Apache-2.0 的本地级联参考，包括 VAD、Whisper/FunASR、可替换 LLM 和 Qwen3-TTS，适合作为自建 PoC，不建议直接当作完整生产编排层。

### 路线 C：混合模式（推荐）

- 欢迎、澄清、解释和普通问答走端到端语音；
- 关键字段同步生成文本或结构化事件；
- 身份、金额、日期、权限和最终动作切入可审计流程；
- 端到端模型异常时降级到级联链路；
- UI 始终以 AionCore 的结构化状态为准，不以模型口头表达为准。

## 开源项目优先级

| 项目                                                                                                | 能直接获得什么                                                | 许可证                | 建议                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------- | ---------------------------- |
| [LiveKit Agents](https://github.com/livekit/agents) + [LiveKit](https://github.com/livekit/livekit) | WebRTC、跨端 SDK、Agent 会话、打断、轮次、工具、任务、伸缩    | Apache-2.0            | **生产综合首选**             |
| [Pipecat](https://github.com/pipecat-ai/pipecat)                                                    | 可插拔实时音频 pipeline、S2S/ASR/LLM/TTS、WebRTC 和客户端 SDK | BSD-2-Clause          | **深度定制首选**             |
| [Pipecat Flows](https://docs.pipecat.ai/pipecat-flows/introduction)                                 | 用节点、状态和工具组织结构化多轮业务                          | 随 Pipecat            | 业务流程实现的重要参考       |
| [Pipecat Voice UI Kit](https://github.com/pipecat-ai/voice-ui-kit)                                  | React 语音控制、波形、状态和调试界面                          | 以仓库许可证为准      | 参考交互，不直接照搬视觉风格 |
| [火山 RTC AIGC Demo](https://github.com/volcengine/rtc-aigc-demo)                                   | 豆包/火山 RTC、ASR、LLM、TTS 的端到端示例                     | 使用前单独审计        | **最接近豆包产品链路的参考** |
| [Hugging Face Speech-to-Speech](https://github.com/huggingface/speech-to-speech)                    | 完全开源的本地级联语音 Agent                                  | Apache-2.0            | 自建和离线 PoC               |
| [TEN Framework](https://github.com/TEN-framework/ten-framework)                                     | 实时多模态 Agent、VAD、turn detection 和示例                  | Apache-2.0 加额外限制 | 只参考，商用前必须法务审查   |

### LiveKit 与 Pipecat 如何选

选择 LiveKit，如果更关注：

- Electron、Web、iOS、Android 多端统一；
- 生产 WebRTC、会话伸缩、弱网和观测；
- 希望用较少的音频基础设施代码完成上线。

选择 Pipecat，如果更关注：

- 频繁组合、替换或自建 ASR/TTS/S2S；
- 需要在音频管线中插入自定义处理器；
- 希望用 Pipecat Flows 直接表达结构化对话节点。

也可以使用 LiveKit 作为 WebRTC 媒体层、Pipecat 作为 Agent pipeline，但第一版不建议同时引入两套编排抽象。先选一个完成真实业务闭环，再根据明确缺口组合。

## 端到端开源语音模型

| 模型                                                      | 能力                                                                     | 适用判断                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [MiniCPM-o 4.5](https://github.com/OpenBMB/MiniCPM-o)     | 中英双语、端到端音频输入输出、全双工、WebRTC Demo，代码和权重 Apache-2.0 | **中文端到端 PoC 首选**；官方仍列出误读、混语和 Web 延迟限制 |
| [Step-Audio 2](https://github.com/stepfun-ai/Step-Audio2) | 中文语音理解、情绪、工具调用和多模态 RAG，mini 版本 Apache-2.0           | 中文业务能力研究价值高，先做离线和并发评测                   |
| [Lychee-FD](https://github.com/HITsz-TMG/Lychee-FD)       | 原生端到端全双工、在线 vLLM pipeline、浏览器 Demo                        | 2026-07 新项目，适合跟踪和实验，不作为首个生产依赖           |
| [Moshi](https://github.com/kyutai-labs/moshi)             | 原生双音频流、全双工、Rust/MLX/PyTorch，理论延迟 160 ms                  | 全双工架构参考优秀，但中文不是其生产强项                     |
| [Covo-Audio](https://github.com/Tencent/Covo-Audio)       | 端到端音频理解与全双工变体                                               | 新模型，需验证权重、服务化和中文真实业务表现                 |

开源模型的公开 Demo 自然，不等于业务完成可靠。必须用自己的中文业务语料、设备和网络做盲测，并单独检查模型权重、音色和第三方组件许可证。

## 交互实现细节

1. 麦克风采集启用浏览器 `echoCancellation`、`noiseSuppression` 和 `autoGainControl`，但保留设备维度的 A/B 配置；
2. 使用耳机和扬声器分别测试，扬声器场景必须处理 AI 自己声音被再次识别的问题；
3. 用户打断时立即清空客户端播放缓冲，并取消服务端生成，不能只把播放器静音；
4. 发送 20–40 ms 音频块，避免客户端先缓存一秒再上传；Gemini Live 的最佳实践也明确建议小块发送，并在收到 interrupted 后立刻丢弃客户端音频缓冲。[Live API 最佳实践](https://ai.google.dev/gemini-api/docs/live-api/best-practices)
5. AI 播放到用户真正听到的位置需要回写会话上下文，避免打断后模型误以为整段回答已播完；
6. 工具超过约 600 ms 时先说短反馈；长任务进入后台并通过结构化事件更新；
7. 会话事件和业务事件分开：前者可高频，后者带版本号并可持久化；
8. 音频、转写和业务字段按最小化原则采集，默认不要把原始音频永久保存。

## AionUi 接口边界建议

AionUi 不应直接持有第三方长期模型密钥。建议通过 adapter 获取短期 Voice Session 凭证：

```text
POST /voice/sessions
POST /voice/sessions/{id}/end
POST /voice/sessions/{id}/confirm
GET  /voice/sessions/{id}
WS   /voice/sessions/{id}/events
```

WebRTC 承载音频，WS/数据通道只传结构化事件：

```text
session.ready
user.speech_started / user.speech_ended
transcript.partial / transcript.final
agent.thinking / agent.speaking / agent.interrupted
business.stage_changed / business.slots_changed
tool.started / tool.completed / tool.failed
confirmation.required / confirmation.accepted / confirmation.rejected
session.reconnecting / session.ended / session.error
```

业务写操作继续通过 AionCore 已有工具与权限体系执行，不新增绕过 common adapter 的 Electron IPC。

## 建议 PoC

首个 PoC 不做通用语音助手，选择一个需要 4–6 轮才能完成、允许用户改口的真实业务，例如“查询可选项 → 收集日期和对象 → 校验 → 用户修改 → 最终确认 → 创建记录”。

同时实现两条模型链路：

1. `LiveKit Agents + 豆包端到端实时语音 + AionCore 状态机/工具`；
2. `LiveKit Agents + FunASR/SenseVoice + 现有 LLM/工具 + Qwen3-TTS/CosyVoice`。

使用同一批中文录音和真实设备盲测：

- 自然度、抢话和打断体验；
- 半句话、长停顿、附和词和背景人声；
- 字段提取、用户改口和跨步骤回退；
- 工具超时、失败、重复提交和断线重连；
- 端到端 P50/P95、分钟成本和并发资源。

如果路线 1 的体验显著更好且业务正确率相当，采用混合模式上线；如果关键流程仍频繁出现字段或确认偏差，让业务阶段强制切到级联文本路径，而不是继续堆叠提示词。
