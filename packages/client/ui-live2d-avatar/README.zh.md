---
description: "Live2D 桌宠（@deepseek-ai/dsh-client-ui-live2d-avatar）：悬浮在 Web 对话上的可拖拽小圆，口型随朗读、表情随回复情绪。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-live2d-avatar

[English](README.md) | 中文

## 概述

本包把消费级 fork 的吉祥物搬上屏幕：Live2D 小圆模型悬浮在对话视图一角，可拖拽，有待机动作、点击触发的动作、TTS 朗读时的口型同步，以及对每条回复分类情绪的表情跟随。偏好（可见性、高度、不透明度、停靠边、动作频率、口型、表情跟随）是易变设置，可在 Web 设置页即时修改；位置记忆在 localStorage。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 补丁层挂载插件；浏览器半边经组合后的 Web 客户端插件 bundle 注册。模型资产与 Cubism Core 由 Web 应用的静态目录伺服。

### 何时选择它

任何想要桌宠陪伴的部署都适用。没有 emotion-express 包时桌宠照常渲染、动作、口型同步；表情跟随在两半都挂载前保持默认关闭。

### 最小配置

```yaml
- insert:
    - id: ui-live2d-avatar
      name: '@deepseek-ai/dsh-client-ui-live2d-avatar'
```

运行时偏好是易变字段（可见性、高度、不透明度、停靠边、动作频率、口型、表情跟随），在 Web 客户端的「设置 → 小圆桌宠」修改。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

浏览器半边经 pixi.js 与 pixi-live2d-display-lipsyncpatch 渲染模型：待机动作按频率设置循环，点击触发随机动作，口型通路代理音频元素让模型的嘴型参数跟随 TTS 播放；说话时暂停环境动作。表情跟随监听 emotion-express 包的 window 事件，把每个情绪键按名字映射到模型的一个表情文件，先对照模型声明的表情清单校验名字，中性时恢复待机状态。设置变化会干净地重启渲染循环；卸载按相反顺序清理所有监听与订阅。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [emotion-express 包](../ui-emotion-express/README.zh.md) —— 广播本桌宠所跟随情绪的分类器。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

以下为当前包约束。

- 模型资产与「情绪→表情」映射为内置小圆模型调校；换其他 Live2D 模型需在设置默认值里重新映射表情名。
- 桌宠只渲染在 Web 客户端视口内；桌面外壳的置顶陪伴窗口延期到桌面打包里程碑。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

为消费级产品 fork 创建（2026-10-06 用户指示）；口型同步随语音里程碑落地，表情跟随随情感里程碑落地（2026-10-07）。模型与 Cubism Core 由 Web 应用静态目录伺服，与其他二进制资产到达浏览器的方式一致，插件自身不持有 URL 面。

</details>
