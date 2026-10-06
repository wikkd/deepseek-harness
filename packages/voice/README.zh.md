---
description: "voice 组地图：随宿主 profile 启停、托管本地 TTS 引擎的伴生语音栈。"
kind: "package-group"
---

# packages/voice

[English](README.md) | 中文

## 概述

voice 组承载伴生语音栈：随宿主 profile 启停的插件，负责拉起并托管本地语音引擎。每个包经由文档化的提供方缝隙（当前是 dsh-tts 的 `custom` provider）暴露引擎，并自持其子进程、端口与转码管线。当本地合成引擎需要「随 profile 启、随 profile 停」时选这一组；引擎本体始终是配置指向的外部 checkout，绝不打包进仓库。

## 目录

- [包列表](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包列表

| 包 | 职责 | ctx key |
|---|---|---|
| [`gptsovits-voice`](gptsovits-voice/README.zh.md) | GPT-SoVITS api_v2 伴生进程 + OpenAI 兼容 TTS 桥 | 消费 `ctx.logger`，不注册服务 |

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

本组的包刻意保持「机器部署」形态：一切路径与端口都是配置字段，组内绝不硬编码引擎位置。后续新增引擎应遵循同一缝隙——dsh-tts 链可寻址的 provider 加一个受管子进程。

</details>
