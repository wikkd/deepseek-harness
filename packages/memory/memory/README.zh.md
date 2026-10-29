---
description: "长期记忆约定：条目类型、同意与可用性状态、ctx.memory 服务，以及在设置变更时添加或撤下模型工具的设置变更事件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

[English](README.md) | 中文

## 概述

`dsh-memory` 是持久长期记忆的类型与服务约定：条目词汇（`user`、`preference`、`fact`）、同意与可用性状态、`ctx.memory` 服务，以及 `memory/settings-changed` 事件。当你实现提供方、模型工具或设置界面时使用它；本包不包含存储、工具或模型提示词。本地提供方是 [`memory-local`](../memory-local/README.zh.md)；面向模型的工具是 [`tool-memory`](../tool-memory/README.zh.md)。

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

在 Host 代码中从 `@deepseek-ai/dsh-memory` 导入约定，在浏览器代码中从 `@deepseek-ai/dsh-memory/types` 导入。本包没有插件入口，也没有配置；挂载提供方才会让 `ctx.memory` 可用。

### 它声明了什么

- `MemoryEntry` 与 `MemoryId` 标识一句已存储的话及其稳定身份。
- `MEMORY_KINDS` 固定接受的类别：`user`、`preference` 与 `fact`。
- `MemoryService` 定义同步读取、持久变更、同意与可用性。
- `MemoryError` 携带稳定错误码（`not-ready`、`disabled`、`consent-required`、`blank`、`too-large`、`limit`、`duplicate`、`not-found`、`invalid-kind`），让调用方呈现具体的恢复提示。
- `memory/settings-changed` 宣告持久设置变更；工具与提示词所有者据此添加或撤下自己的界面。

### 同意与可用性

全新的提供方报告 `consented: false` 与 `enabled: false`。开启需要先记录同意；撤回同意也会关闭可用性。关闭会保留条目与同意，因此用户重新开启时无需再次同意。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包是词汇与 seam 声明。它有意不拥有存储、进程或模型注册；这些属于提供方与消费方包。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | 条目、设置、快照、服务、错误与事件声明 |
| [`src/index.ts`](src/index.ts) | 约定的公开运行时导出 |

### 为什么读取是同步的

`list()` 与 `snapshot()` 返回提供方的权威内存状态。本地提供方把该状态与其持久领域放在一起，因此提示词组装无需等待磁盘。由远程服务支撑的提供方必须在本地缓存一致副本，而不是让模型等待网络往返。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [memory 组地图](../README.zh.md)——提供方、工具与设置页的汇总表。
- [本地提供方](../memory-local/README.zh.md)——持久 JSON 存储、边界与设置 Remote。
- [面向模型的工具](../tool-memory/README.zh.md)——显式保存、搜索、遗忘与有界提示词区段。
- [记忆设置页](../../client/ui-settings-memory/README.zh.md)——同意、开关与条目管理。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory-local)——提供方与提示词的边界。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只声明记忆约定；提供方与工具包负责持久化和所有面向模型的贡献。

#### KV Cache 影响

无；本约定既不组装也不发送模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅有约定**——挂载本包不会提供存储、工具或提示词区段；需要提供方与工具消费方。
- **仅显式保存**——约定不包含自动会话提取或后台学习路径。
- **同步读取**——无法从本地状态作答的提供方必须借助缓存才能实现该 seam。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
