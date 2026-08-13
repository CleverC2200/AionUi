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

## Wayfinding operations

- 地图：创建带 `wayfinder:map` 标签的 GitHub Issue，正文只保存 Destination、Notes、Decisions so far、Not yet specified 和 Out of scope。
- 决策票：创建带 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task` 标签的 Issue，再通过 GitHub Sub-issues API 挂到地图下。
- 领取：开始处理前先把决策票指派给当前执行者；开放且未指派的票才可进入 frontier。
- 阻塞：通过 GitHub Issue dependencies API 把 blocking issue 添加到被阻塞票的 `blocked_by` 关系；不在正文复制依赖清单。
- Frontier：查询地图的开放子 Issue，排除已有 assignee 或仍有开放 `blocked_by` 关系的票，按子 Issue 顺序选择第一项。
- 解决：在决策票留下 resolution comment，关闭该票，再把名称、链接和一行结论追加到地图的 Decisions so far。
