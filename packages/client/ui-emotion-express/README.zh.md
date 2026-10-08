---
description: "情感表情桥（@deepseek-ai/dsh-client-ui-emotion-express）：对每条完成的助手回复做情绪分类，经 window 事件广播给 Live2D 桌宠消费。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-emotion-express

[English](README.md) | 中文

## 概述

本包为消费级 fork 的桌宠提供情感表情：每条助手回复完成时，浏览器半边用规则情绪词典加标点线索把可见文本分为五种情绪（喜、怒、哀、惊、中性）之一，并广播 `dsh-emotion:expression` window 事件。Live2D 头像包消费该事件并设置对应表情。不影响模型请求，不落任何存储。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 补丁层与 Live2D 头像包一起挂载；浏览器半边经组合后的 Web 客户端插件 bundle 注册。

### 何时选择它

当部署的桌宠需要随回复语气变换表情时选择它。没有 `dsh-emotion:expression` 事件的消费者时本插件不起作用：分类照常运行、事件照常派发，但看不到任何变化。

### 最小配置

```yaml
- insert:
    - id: ui-emotion-express
      name: '@deepseek-ai/dsh-client-ui-emotion-express'
```

插件没有配置字段；每条完成的助手回复自动分类。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

浏览器半边经 sessions 服务订阅主视图会话的事件源，对每条完成的 `assistant/message` 的可见文本块分类（跳过被打断的回复），并派发一个 window CustomEvent，载荷携带情绪键与单调递增的序号。序号用于去重重排的回放；主视图会话变化时重新挂接订阅。分类器按加权词典（中英文）加标点与颜文字线索计分，取最高分，打平归中性。事件名与载荷形状在本包声明一次，由头像包结构化复刻消费——无跨包运行时依赖。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Live2D 头像包](../ui-live2d-avatar/README.zh.md) —— 消费表情事件的桌宠。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

以下为当前包约束。

- 规则分类器以召回率换零成本：反讽、混合语气的回复、词典外的用语都归中性。模型分类器是计划中的后继者；模型不可用或低置信时，本规则路径保留为兜底。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

为消费级产品 fork 创建（2026-10-07 用户指示），是情感表情设计笔记的方案 B：规则分类器先行落地，事件通道与映射层按日后模型方案替换的需求构建。node 半边按 Service Definition 约定保留为空操作；全部行为在浏览器半边。

</details>
