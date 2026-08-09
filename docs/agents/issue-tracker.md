# Issue tracker: GitHub

本仓库的工作项发布到 `CleverC2200/AionUi` GitHub Issues，统一使用 `gh` CLI。

## 约定

- 发布 ticket：创建一个 GitHub Issue。
- 读取 ticket：读取 issue 正文、评论和标签。
- Ticket 按依赖顺序创建。
- 优先使用 GitHub 原生 issue dependency 表达 blocking edges。
- 原生依赖不可用时，在正文写入 `Blocked by: #<number>`。
- 可执行 ticket 添加 `ready-for-agent`。
- Pull Request 不作为需求或 triage 入口。
- 不关闭或修改来源 parent issue。
