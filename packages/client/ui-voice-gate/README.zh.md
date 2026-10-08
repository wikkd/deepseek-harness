---
description: "语音同步门（@deepseek-ai/dsh-client-ui-voice-gate）：流式段落写完先隐身，等朗读音频就绪再显示，文字与语音同步到达。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice-gate

[English](README.md) | 中文

## 概述

本包消除语音对话中的「读超前」：dsh-tts 朗读回复时，每段写完的流式段落先隐身，等对应的朗读音频就绪再显示——用户听到一句、浮现一句，而不是对着静音屏幕读完全文。它跟随所观察的 dsh-tts 插件配置，自身没有偏好设置面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 补丁层与 dsh-tts 一起挂载；浏览器半边经组合后的 Web 客户端插件 bundle 注册。

### 何时选择它

只要部署里 dsh-tts 会朗读回复就选它。没有 dsh-tts 时门永不介入：没有朗读态就没有隐身，对话照常渲染。

### 最小配置

```yaml
- insert:
    - id: ui-voice-gate
      name: '@deepseek-ai/dsh-client-ui-voice-gate'
```

插件没有配置字段；它跟随 dsh-tts 插件的「朗读回复」状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

门刻意做在 DOM 层：观察聊天视图的流式正文标记，切换一个 data 属性，由注入的样式表转为 `visibility: hidden`。布局保留，滚动位置与回合侧栏不动。就绪信号与 dsh-tts 播放器消费的相同：TTS 流的 utterance 与 error 事件，加重连补漏的 pending 轮询。两种信号都没放行的隐身会在超时后自动打开，TTS 链路坏了退化为无门视图，正文不会被永久藏住。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-tts](https://www.npmjs.com/package/@goodandready/dsh-tts) —— 驱动门状态的语音插件。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

以下为当前包约束。

- 门以聊天视图的流式标记为键，聊天组件重命名该标记时本包选择器需同步更新；该标记尚无导出的契约。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

为消费级产品 fork 的语音里程碑创建（2026-09 用户指示）：TTS 播放器的被动式打断监听留下了文字超前于语音的空档。node 半边只负责关闭自动生成的设置页；全部行为在浏览器半边。

</details>
