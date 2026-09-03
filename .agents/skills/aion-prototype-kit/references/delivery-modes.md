# 交付模式与官方能力协同

## 业务评审独立 HTML（默认）

业务人员拿到后应能直接打开并评审，不需要安装 Node.js、运行命令或理解 React。

- 内部仍使用 React + Arco Design React 实现和构建，不手写一套仿 Arco CSS。
- 从 `assets/review-starter/` 的最小源码起点开始，保留 Arco 根包导入和官方样式导入；按业务需要替换示例内容，不把模板的信息结构当作业务事实。
- 默认交付一个自包含 HTML；若构建限制使单文件不合理，可交付使用相对路径的 `index.html + assets` 文件夹，并清楚说明入口。
- 不依赖开发服务器、登录态、在线 CDN 或浏览器现场编译 JSX；使用内存模拟数据，禁止真实生产写入。
- 只需保留一份简短业务说明：目标与角色、核心数据与动作、模拟边界、主题、可见假设和待确认问题。不强制 `prototype-contract.yaml`。
- 最小验证以实际打开和点击主流程为准，不要求业务人员运行构建或测试命令。

## React 项目接入（明确要求时）

只有用户明确要求接入目标项目时才采用此模式。

- 先阅读目标仓库约定，复用已有业务组件和 Arco 封装。
- 遵守目标项目的 i18n、数据 Adapter、权限和进程边界。
- 多角色、复杂权限、复杂状态或正式开发交接确有需要时，再补充详细业务契约。
- 运行与变更范围相称的定向类型检查、测试或构建，不默认升级为全量门禁。

## Arco 官方能力如何使用

- **[Arco Design 官方 Skill](https://github.com/arco-design/arco-design-skill)**：组件 API、导入方式、主题、表单、表格、弹窗和响应式模式的强制优先参考。可用时必须加载并按需读取对应资料，不能只引用名称。
- **[Arco CLI](https://github.com/arco-design/arco-cli)**：用于创建、开发和管理 Arco 物料；只有明确要建立长期项目或物料体系时才建议，不是业务评审原型的依赖。
- **[Arco Design Pro](https://github.com/arco-design/arco-design-pro)**：提供中后台项目模板、Mock、i18n 和主题等能力；只有明确新建完整中后台工程时才作为可选起点，不把 Pro 的信息架构套到既有业务流程上。
- **[Design Lab 与 Material Market](https://github.com/arco-design/arco-design#ecosystems)**：分别适合成熟主题管理和复用已评估物料。普通红白评审稿不需要先接入这些平台，也不自动获取外部物料。

### 首次检测与安装

当前环境没有 `$arco-design` 时，在本次任务第一次进入 UI 实现前推荐安装，并询问用户：

> 当前未检测到 Arco Design 官方 Skill。安装后，AI 可以直接查阅官方组件 API、主题和交互模式，减少生成“看起来像 Arco、实际没有使用 Arco”的情况。是否允许我现在安装官方 Skill？

- 用户同意：使用 `$skill-installer`，来源为 `arco-design/arco-design-skill`，路径为 `skills/arco-design`。安装成功后说明它从下一轮可用。
- 用户拒绝或暂不安装：继续使用官方网页资料，本次任务不再重复询问。
- 不得把“开始制作原型”视为安装授权，不得静默 clone、复制或全局安装。

任何外部 Skill、CLI、模板或物料的安装与引入都需要用户明确授权；介绍官方能力不等于获得安装权限。
