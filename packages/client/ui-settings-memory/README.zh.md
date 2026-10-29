---
description: "设置中的记忆页：首次运行同意、可用性开关、显式的新增/修改/删除/清空控件，以及生成的 remote.memory 客户端接线。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-memory

[English](README.md) | 中文

## 概述

`dsh-client-ui-settings-memory` 在设置中添加记忆页：首次运行同意、一个可用性开关、带类型选择器的新增表单，以及逐条修改、删除与清空全部。它通过生成的 `remote.memory` 命名空间读取并修改 Host 记忆服务，从不直接接触存储。Host 半部分是空的可加载插件，以便注入浏览器 bundle；只有在 Web 设置外壳存在时页面才会出现。

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

把本包作为一行 Host 条目挂载；浏览器半部分会自行注册到 `settings.section` 槽位。页面没有配置字段。

```yaml
- id: ui-settings-memory
  name: '@deepseek-ai/dsh-client-ui-settings-memory'
```

客户端插件注入 `@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-settings` 与 `@deepseek-ai/dsh-api-remotes`，并需要 Host 提供方提供的 `remote.memory`。

### 首次运行同意

同意之前，页面显示一张说明记忆仅保存在本机的卡片。唯一操作会记录同意并开启记忆。在该操作完成前，不能保存条目，模型工具也不可见。

### 日常控件

- 开关开启或关闭面向模型的记忆界面。关闭后条目仍然可见并已存储；页面说明它们不再提供给助手。
- 新增表单接收一句话与一个类型（`关于你`、`偏好` 或 `其他事实`）。保存成功后清空输入。
- 每条条目显示类型与文本，并提供修改与删除。修改只替换文本，类型保持不变。
- 清空全部需要第二次确认点击（`确认清空`），且无法撤销。

### 错误与忙碌状态

首次读取显示 `正在读取记忆…`；读取失败显示 `再试一次`。每次变更运行时都会禁用控件，并排在此前变更之后串行执行。Host 拒绝会显示在列表上方的警告中；页面保留上一份快照。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释浏览器对象层与注册方式；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计选择

- **一个控制器、一份快照。** `MemorySectionController` 用快照存储持有页面状态，并在变更后从 Host 刷新。
- **同意是两次持久写入。** 同意操作先调用 `setConsent(true)`，再调用 `setEnabled(true)`；若两步之间失败，下一次读取会显示 Host 的权威状态。
- **仅走 Remote。** 页面从不读取 JSON 文件或导入提供方；`remote.memory` 是唯一数据通道。
- **文案归 locale 所有。** 两份字典都在 `locales.ts`；槽位提供命名空间与标签。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 半部分：空插件，使包可在 Host 组合中加载 |
| [`src/client/index.ts`](src/client/index.ts) | 设置区段注册、字典、注入的操作 |
| [`src/client/controller.ts`](src/client/controller.ts) | 快照状态、首次读取、串行变更、错误消息 |
| [`src/client/MemorySection.tsx`](src/client/MemorySection.tsx) | 同意卡片、开关、新增表单、条目列表、清空确认 |
| [`src/client/locales.ts`](src/client/locales.ts) | 中英文文案 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [memory 组地图](../../memory/README.zh.md)——约定、提供方、工具与本页的汇总。
- [本地提供方](../../memory/memory-local/README.zh.md)——`remote.memory` 背后的持久状态。
- [面向模型的工具](../../memory/tool-memory/README.zh.md)——开关让模型看到的内容。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory)——模型收到的 `memory_*` schema。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory-local)——通过默认值在本页体现的提供方与提示词边界。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这是浏览器设置界面，其写入归 Host 记忆服务及其面向模型的工具插件所有。

#### KV Cache 影响

无；页面不直接改变请求，设置写入只会经由提供方与工具插件影响前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无搜索或分页**——页面渲染快照返回的每个条目；大量存储会变成一张长列表。
- **单条删除没有确认**——只有清空全部需要第二次点击。
- **仅修改文本**——无法从页面改变条目的类型。
- **无法撤销**——在此无法恢复已删除的条目或已清空的存储。
- **没有撤回同意的控件**——页面可以关闭记忆，但撤回同意需要 Host 方法或其他界面。
- **没有秘密检测**——页面接受用户提交的任何句子；过滤留给用户与模型工具的说明。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

页面依赖 `@deepseek-ai/dsh-api-remotes` 中生成的 `remote.memory` 客户端贡献。修改 Remote 方法或快照字段时，必须在同一变更中重新生成该贡献并更新本控制器。产品文案归 locale 所有；两份字典需一起添加。

</details>
