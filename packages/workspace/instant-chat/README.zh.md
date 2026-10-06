---
description: "即时对话（@deepseek-ai/dsh-instant-chat）：保证默认工作区存在，Web 界面无需先选目录即可直接开始对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-instant-chat

[English](README.md) | 中文

## 概述

当 Web 界面绝不能停在「选择工作区」死胡同时使用本包。插件在 profile 启动时检查 `ctx.workspaceRegistry`：注册表为空时就在 harness home 下创建一个工作区，客户端的最近工作区恢复随即直接进入对话，输入框无需任何目录选择即解锁。注册表非空时不做任何事。创建失败只记警告、绝不阻断启动；手动的工作区选择器仍是兜底。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 补丁层挂载插件即可；它不需要客户端半边。

### 何时选择它

面向「操作者从不选目录」的消费级部署选它。开发者 profile 里希望空注册表弹出工作区选择器时避免它；内置的首用初始化可接受时也不需要它——那条内置路径只在「注册表与会话历史都为空」时生效，且其默认注册一旦被删除就永久失效，这正是本插件要关闭的死局。

### 最小配置

```yaml
- insert:
    - id: instant-chat
      name: '@deepseek-ai/dsh-instant-chat'
      config: {}
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | `''` | 默认工作区目录。留空使用 `<DSH_HOME>/workspaces/default`。`~` 按操作系统主目录展开；相对路径按宿主进程 cwd 解析。 |
| `title` | `'Default'` | 侧边栏显示标题。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-instant-chat)是全部受接受字段的穷尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

插件注入 `workspaceRegistry` 服务，在 `apply` 时检查：`registry.list()` 为空则递归建目录并 `create()` 注册。`registry.create` 按规范化路径幂等，因此与内置 `initializeDefault` 首用流程共存安全：先到者持有记录，后到者复用。默认路径经 `@deepseek-ai/dsh-home-paths` 解析，工作区落在本 fork 的隔离 home 下。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [workspace 包](../README.zh.md) —— 本插件消费的注册表服务。
- [cordis 配置入门](../../../docs/cordis-primer.zh.md) —— 补丁层组合方式。
- [Web app bundle](../../bundle/web-app/README.zh.md) —— 客户端最近工作区恢复行为。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

以下为当前包约束。

- 插件只在注册表为空时动作；手动删光工作区的注册表仍算非空，不会被处理。
- 创建的工作区只是宿主状态；除解锁输入框外没有任何引导流程。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

本包是本 fork 不得引用的某本机第三方插件的仓库内替代（AGENTS.md 插件隔离规则）。默认 home 路径必须继续走 `@deepseek-ai/dsh-home-paths`；手写 `homedir()` 兜底会把运行态泄漏进上游 dsh 安装。

</details>
