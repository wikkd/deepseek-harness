---
description: "本地长期记忆提供方：在产品数据目录中保存同意与可用性状态及持久条目，并由可配置的条目数量与长度上限约束。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-local

[English](README.md) | 中文

## 概述

`dsh-memory-local` 提供 `ctx.memory`，并作为共享存储栈中的 JSON 领域把记忆保存在产品数据目录。它负责首次运行的同意门禁、可用性开关、条目上限、精确重复刷新、原地修改、删除，以及生成的 `remote.memory` 设置方法。任何内容都不会离开本机，记忆读写也不参与模型调用。每个 profile 挂载一次即可；模型工具与提示词区段来自 [`tool-memory`](../tool-memory/README.zh.md)。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在共享存储栈之后挂载本行。提供方打开一个存储领域，并从其持久内存状态提供同步读取。

```yaml
- id: memory-local
  name: '@deepseek-ai/dsh-memory-local'
  config:
    maxEntries: 200
    maxEntryChars: 2000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxEntries` | `200` | 保留条目的上限；达到上限后拒绝新保存 |
| `maxEntryChars` | `2000` | 单条条目裁剪后的最大长度（UTF-16 代码单元） |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory-local)是受支持字段的穷尽式真源。

### 首次运行与同意

全新的领域报告 `enabled: false` 与 `consented: false`。在记录 `setConsent(true)` 之前，`setEnabled(true)` 会以 `consent-required` 失败。撤回同意会关闭记忆，但会保留条目并移除同意；仅关闭则同时保留同意与条目，因此用户重新开启时无需重复同意步骤。

### 每个操作做什么

`save()` 裁剪文本，拒绝空或超长输入，并在已存在完全相同文本的条目时刷新类型与时间戳。重复保存保留原 id 与创建时间。`update()` 原地替换文本，保留 id 与创建时间，并拒绝不存在的目标或被另一条条目使用的文本。`forget()` 按 id 删除并报告条目是否存在。`clear()` 删除所有条目，不改变同意或可用性。条目按最近更新在前、再按 id 排序。

### 存储与 Remote

领域位于 `<DSH_HOME>/storages/memory.json`，使用 base bundle 的 `storage-json` 根。`snapshot`、`setEnabled`、`setConsent`、`save`、`update`、`forget` 与 `clear` 被装饰到生成的 `remote.memory` 命名空间，因此设置页读取并修改同一份权威状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方如何保持持久状态一致；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计选择

- **一个存储领域、一个所有者。** 同意与条目共享带版本的 `memory` 领域，因此设置变更与条目写入不会落到不同文件。
- **串行变更。** 每个变更排在一条 promise 链上；并发保存无法突破上限，失败变更也不会阻塞后续工作。
- **从持久状态同步读取。** 领域的内存表在两次写入之间是权威状态，因此提示词组装无需等待磁盘或网络。
- **显式去重。** 精确文本是重复键；重复保存刷新元数据，而不是创建第二行。
- **Remote 方法是设置 API。** `TypertRemoteService` 装饰 Host 方法；浏览器设置页从不直接写存储。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务生命周期、存储领域、变更、边界、Remote 方法 |
| [`src/spec.ts`](src/spec.ts) | 带版本的领域规格、存储记录 schema 与表/全局布局 |

### 关闭

服务设置停止标志，等待当前变更链，然后关闭领域。关闭后的调用以 `not-ready` 失败，而不是与关闭过程竞争。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [memory 组地图](../README.zh.md)——约定、提供方、工具与设置页的汇总。
- [记忆约定](../memory/README.zh.md)——本提供方实现的服​​务与错误词汇。
- [面向模型的工具](../tool-memory/README.zh.md)——消费本提供方的提示词区段与 `memory_*` 工具。
- [记忆设置页](../../client/ui-settings-memory/README.zh.md)——同意、可用性、修改、删除与清空控件。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory-local)——每个受支持字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `tool-memory` 把选定条目渲染进提示词区段并暴露记忆工具。

#### KV Cache 影响

间接影响；保存条目只会改变写入之后组装的请求中的提示词区段，未变化的记忆界面保持前缀稳定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **本地明文 JSON**——条目未加密地存放在用户数据目录；产品不声称静态加密。
- **单应用实例**——变更只在单个 Host 进程内串行；共享同一数据目录的两个应用实例不受协调。
- **仅精确文本去重**——近似重复与改写后的事实会形成不同条目。
- **无迁移或导入**——全新领域从空开始；不会读取旧的 `MEMORY.md`/`USER.md` 文件。
- **达到上限拒绝新保存**——达到 `maxEntries` 后，已有重复项仍可刷新，但真正的新条目会以 `limit` 失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

修改 Remote 方法签名或返回类型时，必须在同一变更中重新生成 Remote 产物并更新设置客户端。领域版本是持久文件的一部分；结构性变更应按持久化迁移处理，而不是原地重写。

</details>
