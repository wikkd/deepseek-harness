---
description: "GPT-SoVITS 伴生栈（@deepseek-ai/dsh-gptsovits-voice）：托管 OpenAI 兼容 TTS 桥并管理本地 api_v2 子进程，提供克隆音色合成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gptsovits-voice

[English](README.md) | 中文

## 概述

当 dsh-tts 的 `custom` provider 需要用克隆的 GPT-SoVITS 音色说话时使用本包。插件在本地桥端口按 OpenAI audio-speech 形态伺服 `POST /v1/audio/speech`，经受管的 GPT-SoVITS api_v2 子进程合成，并用内置 `ffmpeg-static` 把 wav 应答转成 mp3。api_v2 进程随 profile 启动（端口空闲时）拉起、随 profile 停止关闭；无需手动跑引擎脚本。一切路径、端口与音色档案都是配置字段。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 补丁层挂载插件，并把 dsh-tts 链的第一项指向 `custom`、`customBaseUrl http://127.0.0.1:<bridgePort>/v1`。

### 何时选择它

机器上已有带训练音色权重的 GPT-SoVITS checkout、且克隆音色回复比云端 TTS 的简单更重要时选它。没有本地 checkout 时避免——本插件配置并看护引擎，但从不随包携带引擎；失败时 dsh-tts 链会滑到下一个 provider。

### 最小配置

```yaml
- insert:
    - id: gptsovits-voice
      name: '@deepseek-ai/dsh-gptsovits-voice'
      config:
        gptsovitsDir: D:/path/to/GPT-SoVITS
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `gptsovitsDir` | `''` | GPT-SoVITS checkout 绝对目录（`api_v2.py` 在其根下）。 |
| `pythonPath` | `''` | api_v2 的 Python 解释器；留空使用 checkout 的 `.venv`。 |
| `host` | `127.0.0.1` | api_v2 与桥共同绑定的主机。 |
| `apiPort` | `9880` | GPT-SoVITS api_v2 端口。 |
| `bridgePort` | `9885` | OpenAI 兼容桥端口。 |
| `apiConfigPath` | `GPT_SoVITS/configs/tts_infer_dsh.yaml` | api_v2 TTS 配置路径，相对 `gptsovitsDir`。 |
| `autostartApi` | `true` | 随 profile 启动拉起 api_v2。 |
| `apiStartupTimeoutMs` | `180000` | 轮询 api 就绪的最长时间，超时记日志。 |
| `requestTimeoutMs` | `180000` | 单次合成请求的 fetch 超时。 |
| `defaultVoice` | `''` | 请求未指名或指错音色档案时使用的音色。 |
| `voices` | `[]` | 克隆音色档案：名称、参考 wav、提示文本、提示/正文语言、辅助参考音频。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-gptsovits-voice)是全部受接受字段的穷尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

桥（`src/bridge.ts`）把请求的 `voice` 映射到配置的音色档案，经 GPT-SoVITS `POST /tts` 合成（注入 api_v2 契约要求的参考音频与提示文本），按请求逐个判定合成语言（片假名 → ja，谚文 → ko，汉字 → zh，其余 en），并把 wav 应答转成 mp3——dsh-tts 把 custom provider 的所有应答当作 `audio/mpeg`。生命周期归属（`src/index.ts`）：`autostartApi` 开启且端口未被占用时拉起 `api_v2.py`，轮询就绪，把输出转发进 dsh 日志；profile 停止时先关桥、再杀进程。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [voice 组](../README.zh.md) —— 本包实现的伴生缝隙。
- [dsh-tts](https://www.npmjs.com/package/@goodandready/dsh-tts) —— 调用桥的 `custom` provider 消费方。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

以下为当前包约束。

- GPT-SoVITS checkout、权重与可用的 GPU 是机器前置条件；插件只校验可达性，不负责安装。
- 每 profile 一个 api_v2 进程与一份音色表；并发合成在引擎自身队列里串行。
- 桥鉴权为直通：本地桥不校验 dsh-tts 凭据，端口必须保持回环绑定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

为消费级产品 fork 的语音里程碑而建（2026-10-03 用户指示）：引擎必须随 profile 生命周期走，而不是手动跑 bat。引擎侧细节（权重配对、提示文本）属于 checkout，不属于本包。

</details>
