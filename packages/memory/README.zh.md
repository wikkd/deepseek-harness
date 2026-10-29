---
description: "memory 组地图：长期记忆约定、本地持久化提供方，以及面向模型的工具与提示词区段，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# memory/：长期记忆能力家族

[English](README.md) | 中文

## 概述

memory 组为助手提供持久、由用户控制的长期记忆。它拆分为共享约定（`memory`）、本地 JSON 持久化提供方（`memory-local`），以及面向模型的工具与有界提示词区段（`tool-memory`）。设置页位于 [`client/ui-settings-memory`](../client/ui-settings-memory/README.zh.md)，通过生成的 `remote.memory` 命名空间访问。记忆初始为关闭且未同意；用户同意之前不会存储任何条目，模型也看不到任何记忆工具。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`memory`](memory/README.zh.md) | 定义条目词汇、同意状态、服务约定与设置变更事件 | `ctx.memory`（声明） |
| [`memory-local`](memory-local/README.zh.md) | 在产品数据目录中存储同意、可用性与条目，并暴露设置 Remote | 提供 `ctx.memory` |
| [`tool-memory`](tool-memory/README.zh.md) | 在记忆活跃时注册 `memory_save`、`memory_search`、`memory_forget` 与有界提示词区段 | 注册到 `ctx.tools` 与 `ctx.systemPrompt` |

-----

<a id="related-documentation"></a>
## 相关文档

- [长期记忆子系统](../../docs/subsystems/memory.zh.md)——条目标识、同意与可用性、快照、失败以及生成的 Cordis API。
- [本地长期记忆 Agent Note](../../.agents/notes/implemented/architecture/2026-10-22-local-long-term-memory.zh.md)——为什么记忆仅限本地、显式保存且需用户同意。
- [记忆设置页](../client/ui-settings-memory/README.zh.md)——浏览器端的同意、开关与条目管理界面。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory)——模型收到的确切 `memory_*` schema。
- [生成的配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-memory-local)——提供方与工具提示词的边界。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
