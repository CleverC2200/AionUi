# AionUi 项目约定

## 项目事实

- AionUi 是 Electron、WebUI 和移动端的产品与编排层；Agent 运行时、业务 API 和主数据由外部 AionCore 提供。
- 桌面入口是 `packages/desktop/src/index.ts`；前端在 `packages/desktop/src/renderer/`；仅原生能力经 `packages/desktop/src/preload/` 连接。
- 业务调用经 `packages/desktop/src/common/adapter/` 的 HTTP/WS 契约完成；不要为后端业务新增绕过该层的 Electron IPC。

## 高风险约束

- Main 进程只能使用 Node.js/Electron Main API；Renderer 只能使用浏览器/React API。跨进程能力只能经 preload 暴露。
- 新增或修改的用户可见文本必须使用 i18n key；新 UI 优先复用项目已有业务组件与封装，其次使用 `@arco-design/web-react`，禁止新增原生交互元素。布局、间距和交互状态沿用同类页面的现有风格，颜色使用语义 Token 或 CSS 变量。
- 保持变更聚焦。不得因当前改动顺带清理既有目录结构或单文件目录问题，也不要改动不属于本次任务的脏文件。
- 开始代码修改、Git 操作或全量门禁前，确认当前 checkout、branch、upstream、worktree 和 dirty/untracked 状态；无关改动可能被扫描或修改时，改用隔离 worktree。
- 源文档已有 `*.zh-CN.md` 对应版本时，修改源文档必须同步更新译文；命令、路径、URL、环境变量和代码块保持可执行。

## 条件资料

- 创建、移动或拆分文件/模块时，阅读 [文件与目录结构](docs/contributing/file-structure.zh-CN.md)。
- 新增或修改 Electron E2E，或需要真实客户端运行态复现、验收 UI、IPC、启动缺陷时，阅读 [E2E 测试指南](tests/e2e/README.zh-CN.md) 中相关部分。
- 修改开发、构建、发布或 PR 流程时，阅读 [贡献指南](CONTRIBUTING.zh.md)。
- 修改 WebUI、AionCore 启动或本地后端配置时，阅读 [开发指南](docs/contributing/development.zh-CN.md)。
- 管理 Issue、标签、依赖或 PR 关闭关系时，阅读 [Issue tracker](docs/agents/issue-tracker.md) 和 [Triage labels](docs/agents/triage-labels.md)。
- 新增或修改领域术语、状态权威、跨模块契约或 ADR 时，阅读 [Domain docs](docs/agents/domain.md)。

## 验证与交付

- 开发中优先运行最接近的定向测试或静态检查；同一 SHA 已通过的完整门禁直接复用记录，只有代码、依赖、配置或目标基线变化后才重跑。
- 只有用户明确要求时才推送。泛称 push、publish 或创建 PR 时默认目标是 `origin` 个人 Fork，并在执行前说明 push remote 与 PR base；官方/upstream 目标必须由用户当轮明确指定。推送前使用 `just push`，不要直接执行 `git push`。
- 技术计划、PRD、设计验收、可行性研究和执行记录默认只保留本地；只有用户逐份明确授权时才纳入公共 push 或 PR。
- 用户明确要求提交 PR 时，默认创建个人 Fork 的 Ready for review PR，并按 [贡献指南](CONTRIBUTING.zh.md) 的“Agent 管理的 PR 跟进”持续处理检查、审查、修复和合并；官方/upstream PR 或合并仍需用户当轮明确指定。
- Commit 和 PR 标题使用英文 Conventional Commit 格式；不得添加 AI 签名。
