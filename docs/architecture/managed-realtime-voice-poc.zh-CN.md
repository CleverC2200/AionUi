# 托管实时语音业务交互 PoC 技术设计

> 状态：阶段 B 联调中；火山 RTC/ASR、聊天框单次听写和客户端模型网关已接通
>
> 日期：2026-08-06
>
> 关联调研：[AI 语音多轮业务交互方案调研](research/ai-voice-interaction.md)

## 1. 目标

在 AionUi 桌面端和 WebUI 中增加持续语音对话入口。用户无需逐轮点击录音，通过与 AI 多轮语音交互完成一个真实业务闭环。

PoC 采用火山引擎托管 RTC 对话式 AI 与豆包实时语音能力：

- 不部署 ASR、TTS、VAD、LLM 或语音大模型；
- 不自建实时媒体服务器；
- 不引入 LiveKit、Pipecat、TEN 等编排框架；
- AionUi 负责 RTC 音频、最终转写触发、交互与展示；
- AionCore 负责凭证、会话，并把语音话轮交给当前 Conversation Agent；
- 当前 Conversation Agent 继续使用原有模型、MCP、技能、权限和业务上下文；
- 首版只实现豆包一个生产 adapter，不建设多供应商框架。

火山官方示例已将 RTC、音频处理、ASR、LLM 和 TTS 作为托管链路，并提供 RTC Token 生成、启动/停止智能体及 Web 端示例。[rtc-aigc-demo](https://github.com/volcengine/rtc-aigc-demo) 官方产品能力还包含实时字幕、上下文管理、打断、判停、Function Calling、MCP 和 RAG。[实时对话式 AI](https://www.volcengine.com/docs/6348/?lang=zh)

## 2. 假设

- 火山引擎账号已开通 RTC、实时对话式 AI 和所需豆包模型资源；
- AionCore 可以安全保存或读取火山 AK/SK、AppId、AppKey 等服务端配置；
- PoC 选择一个已有、低风险、具备幂等能力的业务工具作为写操作；
- 第一阶段只保证单用户、单活动语音会话；
- 用户主动进入语音模式后才采集麦克风，结束后立即释放设备；
- 原始音频默认不持久化，只保留必要的转写、工具审计和指标。

## 3. 成功标准

### 3.1 功能

1. 用户能从现有会话进入和退出实时语音模式；
2. AI 能连续听和说，用户可以在 AI 播放期间打断；
3. UI 能显示连接、聆听、思考、说话、执行工具、等待确认和错误状态；
4. 用户至少通过 4 轮语音完成一次“查询 → 补充字段 → 修改 → 确认 → 执行”；
5. Function Call 只能调用 AionCore 为当前会话开放的工具；
6. 写操作执行前必须复述参数并获得明确确认；
7. 工具失败时 AI 只能播报真实失败或建议重试，不能宣称成功；
8. 会话关闭、页面切换和组件卸载都会释放麦克风与 RTC 连接。

### 3.2 体验

| 指标                               | PoC 门槛 |
| ---------------------------------- | -------: |
| 进入语音模式到可说话 P95           |    < 3 s |
| 用户正常结束话轮到 AI 首包音频 P95 |  < 1.5 s |
| 用户打断到 AI 停止播音 P95         | < 500 ms |
| 工具执行结果与语音播报一致率       |     100% |
| 重复写入                           |        0 |
| 退出后的残留采集或播放             |        0 |

### 3.3 安全

- Renderer、日志和持久化设置中均不出现 AK/SK、AppKey 或长期 Token；
- Renderer 只取得绑定当前用户、房间和短有效期的 RTC Token；
- AionCore 对每次工具调用重新校验当前用户、会话、工具白名单和参数；
- 写操作使用幂等键，确认记录与工具执行记录可关联。

## 4. 非目标

- 电话号码、PSTN、SIP、呼叫中心；
- 本地或私有化部署语音模型；
- 离线语音、唤醒词、后台常驻监听；
- 多人房间、数字人、视频理解、声纹识别；
- 方言和多语种专项优化；
- 语音模型或 RTC 供应商切换 UI；
- 通用可视化工作流编辑器；
- 以现有 `/api/stt/stream` 扩展双向语音协议。

## 5. 总体架构

```text
麦克风 ──RTC──> 火山 ASR ──最终转写──> AionUi VoiceSession
                                           │ POST /turns
                                           ▼
                                  AionCore Voice Session
                                           │
                                           ▼
                              当前 ConversationService / Agent
                              原有模型 + MCP + 技能 + 权限 + 历史
                                           │ 最终文本
                                           ▼
                              火山 UpdateVoiceChat 外部文本转语音
                                           │
                                           └──RTC──> 扬声器
```

音频直接走火山 RTC SDK，不经过 AionCore 和现有 `/api/stt/stream`。火山负责 RTC、ASR、判停、打断和 TTS；AionCore 处理低频控制面，并作为当前客户端 Agent 与业务执行的唯一入口。火山配置中的内置 LLM 回复会在每个话轮开始时被打断，不作为业务答案来源。

## 6. 模块与 seam

### 6.1 Renderer VoiceSession module

新增一个深 module，隐藏 RTC 实例、事件乱序、设备释放、重连、播放中断和 Function Call 转发。React 页面只依赖以下 interface：

```ts
type VoiceSessionSnapshot = {
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error';
  agent: 'idle' | 'listening' | 'thinking' | 'speaking' | 'tool-running' | 'awaiting-confirmation';
  microphoneEnabled: boolean;
  userTranscript: string;
  agentTranscript: string;
  errorCode?: string;
};

type VoiceSessionController = {
  snapshot: VoiceSessionSnapshot;
  start(): Promise<void>;
  stop(): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): void;
  submitConfirmation(confirmationId: string, accepted: boolean): Promise<void>;
};
```

外部依赖是火山 RTC SDK，属于 true external dependency。module 内部定义私有 port，生产使用火山 adapter，测试使用内存 adapter；该 port 不暴露给页面调用方。

首版只有一个生产 adapter，因此不新增公共 `VoiceProvider` interface、供应商注册表或模型选择器。以后确实接入第二家托管供应商时，再把内部 port 提升为真实公共 seam。

### 6.2 AionCore Voice Session module

AionCore 是会话与业务执行的真值所有者。它隐藏火山 AK/SK、RTC Token 签发、智能体任务配置和工具执行。

对 AionUi 只暴露最小 interface：

```text
GET    /api/voice/capabilities
POST   /api/voice/sessions
POST   /api/voice/sessions/{session_id}/start
POST   /api/voice/sessions/{session_id}/turns
DELETE /api/voice/sessions/{session_id}
```

能力响应用于渐进启用入口，旧版或未配置 AionCore 不显示实时语音按钮：

```json
{
  "enabled": true,
  "provider": "volcengine-rtc"
}
```

创建请求：

```json
{
  "conversation_id": "conversation-id",
  "mode": "conversation"
}
```

聊天框单次听写使用 `mode: "dictation"`，不绑定 conversation、不播放欢迎语，并在收到首个最终用户转写后立即结束火山任务；长对话继续使用默认的 `conversation` 模式。

创建响应只包含临时连接材料：

```json
{
  "session_id": "voice-session-id",
  "rtc": {
    "app_id": "public-app-id",
    "room_id": "generated-room-id",
    "user_id": "generated-user-id",
    "token": "short-lived-rtc-token"
  },
  "expires_at": 1786000000000
}
```

不得返回 AK/SK、AppKey、模型访问密钥或可创建其他房间的凭证。

创建会话只签发 RTC Token。AionUi 使用临时凭据进房成功后，再调用 `/start` 启动智能体；该顺序与火山官方 demo 一致，避免智能体先于目标用户入房。创建、启动和结束均绑定当前用户，结束接口保持幂等。

火山返回用户最终转写后，AionUi 调用 `/turns`：

```json
{ "text": "查询本月客户情况" }
```

AionCore 先打断火山内置回复，再通过现有 `ConversationService::send_message` 进入创建语音会话时绑定的 conversation。它只收集该用户、conversation 和 turn 的文本事件，等待 `turn.completed`，然后通过 `UpdateVoiceChat / ExternalTextToSpeech` 播放最终文本。这样语音与聊天框共用同一套模型、MCP、技能、权限和上下文，不再维护第二套工具目录。

### 6.3 现有 adapter seam

AionUi 调用新增端点时继续通过 `packages/desktop/src/common/adapter/` 的 HTTP 契约：

- Electron Renderer 使用 loopback AionCore；
- WebUI 使用同源 `/api/*` 代理；
- 不新增 Electron IPC；
- 不让 Renderer 直接调用火山控制面 OpenAPI。

RTC 媒体连接是唯一允许 Renderer 直连的外部数据面，并且只使用 AionCore 签发的短期 RTC Token。

## 7. 当前 Conversation Agent 与业务执行

语音不直接消费火山 Function Call，也不在 Renderer 执行业务工具。每个最终转写都作为普通用户消息发送到当前 conversation，因此：

- 只读 MCP、业务工具、技能和会话历史沿用聊天框现有能力；
- 权限、工具参数校验和失败语义沿用当前 Agent Runtime；
- Renderer 不接触 MCP 凭证、工具实现或业务返回载荷；
- 同一语音会话只允许一个客户端 Agent 回合执行，后续最终转写按顺序排队；
- 会话结束后，即使未完成回合稍后返回，也不会再触发 TTS。

写操作继续受当前 Conversation Agent 的权限与确认机制约束。阶段 C 若需要纯语音确认，应扩展现有确认事件，而不是恢复一套火山专用工具白名单和确认存储。

## 8. UI 设计

### 8.1 入口

保留两个独立入口，两个入口都显示录音状态和波形动画：

- 聊天框麦克风：优先使用已配置的旧 STT；未配置时回退到火山托管 ASR，录一段并转换成输入文本；
- 标题栏电话入口：进入持续双向对话。

所有新增可见文本使用 i18n key，复用 Arco 和现有 Icon Park 封装，不新增原生交互元素。

### 8.2 会话面板

PoC 面板只包含：

- 当前连接/Agent 状态；
- 用户与 AI 实时字幕；
- 麦克风开关；
- 结束会话按钮；
- 工具执行进度；
- 写操作确认卡；
- 可恢复错误提示。

不加入音色市场、模型参数、工作流编辑器、数字人或高级音频设置。

### 8.3 状态规则

- `connecting`：入口禁用，允许取消；
- `connected + listening`：显示用户波形；
- `speaking`：显示 AI 波形，用户仍可开口打断；
- `tool-running`：播放可打断的短反馈，不允许重复触发同一工具；
- `awaiting-confirmation`：不执行写操作；
- `reconnecting`：麦克风暂停，不丢失 AionCore 业务状态；
- `error/ended`：停止轨道、播放器、计时器和订阅。

## 9. 建议文件范围

AionUi 实现预计只修改或新增以下范围：

```text
packages/desktop/src/common/types/voice/
packages/desktop/src/common/adapter/ipcBridge.ts
packages/desktop/src/renderer/services/voice/
packages/desktop/src/renderer/hooks/voice/
packages/desktop/src/renderer/components/chat/SendBox/
packages/desktop/src/renderer/components/chat/VoiceConversation/
packages/desktop/src/renderer/services/i18n/locales/*/conversation.json
tests/unit/renderer/
tests/e2e/
```

AionCore 变更在其独立仓库完成，包括新增 `/api/voice/*` 路由、火山控制面调用、会话记录、工具校验和确认执行。本仓库不复制或绕过这些业务逻辑。

## 10. 开发清单

### 阶段 A：托管语音闭环

- [x] 开通并验证火山 RTC、实时对话式 AI 和豆包实时语音资源；
- [x] 在 AionUi 中跑通浏览器入房、启动智能体、ASR 回传和退出；
- [x] AionCore 实现创建/启动/删除 Voice Session、短期 RTC Token 与 OpenAPI 签名；
- [x] AionUi 实现 VoiceSession module 和最小会话面板；
- [x] 自动化覆盖页面切换、退出和异常时的媒体资源释放；真实设备仍待人工验收。

门禁：已通过。

### 阶段 B：只读业务工具

- [x] 把最终 ASR 文本转发到当前 Conversation Agent；
- [x] 沿用当前会话的模型、MCP、技能、权限和历史；
- [x] 收集当前 turn 最终文本并交给火山 TTS；
- [x] 恢复客户端个人模型网关；
- [ ] 恢复 `gea-gateway` MCP 后完成真实只读查询；
- [ ] 覆盖超时、空结果、权限不足和参数错误。

门禁：当前个人模型网关已实测恢复，仍需修复 `gea-gateway` MCP 的旧 loopback 端口并完成真实只读查询后才能判定阶段 B 完成。

### 阶段 C：低风险写操作与确认

- [ ] 选择一个具备幂等能力的低风险写工具；
- [ ] 实现 `confirmation_required` 结果和确认卡；
- [ ] 绑定 `session_id + call_id + confirmation_id + idempotency_key`；
- [ ] 拒绝过期、重复、跨用户和已取消确认；
- [ ] 执行后查询真实结果再播报。

门禁：任何重复写入或未确认写入均阻止 PoC 验收。

### 阶段 D：可靠性与验收

- [ ] 测试 AI 播放期间用户打断；
- [ ] 测试长停顿、附和词、改口和返回上一步；
- [ ] 测试网络断开、重连、Token 过期和资源欠费；
- [ ] 测试切换会话、关闭窗口和应用退出；
- [ ] 记录连接耗时、首包延迟、打断延迟和工具耗时；
- [ ] 使用同一业务脚本完成至少 30 次人工回归。

## 11. 验证策略

### 单元测试

- VoiceSession 状态转换与乱序事件；
- `start()` 并发调用只创建一个会话；
- `stop()` 可重复调用且只清理一次；
- 旧会话事件不能污染新会话；
- Function Call 参数完成前不触发工具；
- Token、AK/SK 和工具敏感参数不进入日志；
- 组件卸载后不再触发状态更新。

### DOM 测试

- 入口禁用和状态文案；
- 麦克风开关、结束会话与确认卡；
- 工具失败和可恢复错误；
- 切换文字/录音输入不误启动实时语音。

### 契约测试

- AionUi 使用内存 RTC adapter 测试 VoiceSession 的完整 interface；
- AionCore 使用固定请求/响应样例验证 `/api/voice/*`；
- 火山 adapter 使用官方测试环境做一条最小冒烟测试。

### E2E

实现行为变更时按 `tests/e2e/README.zh-CN.md` 选择最接近的 Electron/WebUI 检查。自动化环境无法稳定提供真实麦克风时，使用虚拟音频输入验证状态和字幕，同时保留真实设备人工验收。

## 12. 风险与止损

| 风险                                    | 止损措施                                                    |
| --------------------------------------- | ----------------------------------------------------------- |
| 火山套餐或账号能力未开通                | 阶段 A 先跑官方 Demo，未通过不写产品代码                    |
| Function Calling 与所选实时模型组合受限 | 先用官方协议完成只读工具冒烟，再确定模型配置                |
| Renderer 收到伪造或重复调用             | AionCore 重新鉴权、白名单、绑定 call_id，并使用幂等键       |
| 端到端模型错误识别关键字段              | UI 展示结构化参数；写操作必须确认                           |
| WebUI 跨网 RTC 失败                     | 使用官方 RTC Token 和网络诊断；不回退为自建裸 PCM WebSocket |
| 厂商 SDK 把长期凭证放入前端             | 阻止上线，只允许短期 RTC Token                              |
| PoC 范围膨胀                            | 坚持一个入口、一个只读工具、一个写工具、一个确认卡          |

## 13. PoC 完成定义

以下条件全部满足才算完成：

- 官方托管链路在 AionUi 内可持续听说和打断；
- 一个真实业务场景通过至少 4 轮语音完成；
- 只读和写工具均返回真实结果；
- 写操作未确认不执行，重复事件不重复写入；
- Renderer 无长期凭证，退出后无残留音频资源；
- 单元、DOM、契约检查通过；
- 30 次人工回归达到本设计的延迟和正确性门槛；
- 未引入本地模型、媒体服务器、多供应商框架或无关重构。
