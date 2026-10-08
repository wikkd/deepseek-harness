---
description: "generate_image 工具（@deepseek-ai/dsh-image-gen）：经本地 ComfyUI 服务或 OpenAI 兼容 images API 文生图，Web 对话中呈现为附件库支持的图片卡片。"
kind: "package-reference"
---

# @deepseek-ai/dsh-image-gen

[English](README.md) | 中文

## 概述

当 agent 需要作画时使用本包。面向模型的 `generate_image` 工具把提示词交给配置的后端——本地 ComfyUI 服务（免 key，图片不出本机）或 OpenAI 兼容 images API——下载图片、提交到持久附件库，并返回一个结构化值，其渲染把文本信封与图片内容块配对。在 ComfyUI 上工具按双档路由：快速检查点（SDXL-Turbo，数秒出图）与精细 GGUF 模型（Qwen-Image，高难度提示词下明显更好）。Web 对话把已完成的调用渲染成按工具名键控的图片卡片；回放经会话授权的附件加载器解析图片，提供方 URL 与密钥都不会进浏览器。

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

在 profile 补丁层挂载插件并保证附件库在位；双面包自带 Web 卡片行。

### 何时选择它

任何需要产出图片的对话界面都适合。ComfyUI 后端适合本地隐私与免 key 运行，但需要 ComfyUI 在跑且检查点就位；`openai-images` 后端适合托管部署，执行时从环境变量读 key。没有持久图片库时工具不注册。

### 最小配置

```yaml
- insert:
    - id: image-gen
      name: '@deepseek-ai/dsh-image-gen'
      config:
        backend: comfyui
        comfyuiDir: D:/path/to/ComfyUI
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `backend` | `'comfyui'` | 生成后端；`comfyui` 免 key 驱动本地服务，`openai-images` 调 OpenAI 兼容 API。 |
| `comfyuiUrl` | `http://127.0.0.1:8188` | 本地 ComfyUI 服务来源。 |
| `comfyuiCheckpoint` | `sd_xl_turbo_1.0_fp16.safetensors` | 快速档检查点名，ComfyUI `models/checkpoints` 下。 |
| `comfyuiSteps` | `2` | 快速档采样步数；turbo 检查点需 1-4。 |
| `comfyuiCfg` | `1` | 快速档 CFG 引导强度；turbo 检查点约 1。 |
| `comfyuiDir` | `''` | ComfyUI checkout 绝对目录（`main.py` 在其根下）。设置后插件代为拉起并看护服务；留空则服务由操作者自己管理。 |
| `comfyuiPythonPath` | `''` | 运行 ComfyUI 的 Python 解释器；留空用 `<comfyuiDir>/python_embeded`。 |
| `comfyuiStartupTimeoutMs` | `120000` | 单次托管启动的截止时间。 |
| `comfyuiExtraArgs` | `''` | 逐字追加的 ComfyUI 额外命令行参数（按空白拆分）。 |
| `comfyuiFineUnet` | `''` | 精细档 GGUF 扩散模型，ComfyUI `models/diffusion_models` 下。与 `comfyuiFineClip`、`comfyuiFineVae` 一起设置即启用双档路由；全空则每张图都走快速检查点。 |
| `comfyuiFineClip` | `''` | 精细档文本编码器，ComfyUI `models/text_encoders` 下。 |
| `comfyuiFineClipType` | `'qwen_image'` | 精细档 CLIPLoader 的 `type` 取值。 |
| `comfyuiFineVae` | `''` | 精细档 VAE，ComfyUI `models/vae` 下。 |
| `comfyuiFineSteps` | `25` | 精细档采样步数。 |
| `comfyuiFineCfg` | `1` | 精细档 CFG 引导强度。 |
| `baseUrl` | `https://api.siliconflow.cn/v1` | OpenAI 兼容 images API 来源；追加 `/images/generations`。仅 `openai-images` 后端。 |
| `model` | `black-forest-labs/FLUX.1-schnell` | 提供方路由的文生图模型 id。仅 `openai-images` 后端。 |
| `apiKeyEnv` | `IMAGE_GEN_API_KEY` | 存放提供方 API key 的环境变量。仅 `openai-images` 后端。 |
| `size` | `1024x1024` | 默认图片尺寸，WIDTHxHEIGHT 像素。 |
| `timeoutMs` | `120000` | 单次生成请求加图片下载的截止时间。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-image-gen)是全部受接受字段的穷尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

工具在 `ctx.inject(['attachments'])` 作用域内注册：没有持久图片库就没有工具。ComfyUI 后端向 `/prompt` 投递两条 API 格式图之一——快速检查点图，或双档路由配置后的 GGUF 图（`UnetLoaderGGUF` + `CLIPLoader` + `VAELoader`）——轮询 `/history` 直到任务报错或产出图片，再经 `/view` 下载。档位逐调用决策：模型的 `quality` 参数声明难度（高难度场景与重文字提示词用 `fine`，草图用 `fast`，省略则交由宿主判断），路由器探测 ComfyUI `/system_stats` 的空闲 RAM/显存——低于余量阈值（4 GiB RAM、4 GiB 显存）时精细档一律让位快速档。路由决策以 `<tier>` 和 `<routing>` 写进面向模型的信封，模型由此得知实际渲染者与原因。设置 `comfyuiDir` 后插件还接管服务生命周期：源上无应答时拉起 `main.py`，并发出图共享同一次启动，崩溃后的下一张图自动重启，profile 停止时杀掉子进程；checkout、解释器或精细档模型文件缺失在加载期响亮报错。`openai-images` 后端携执行时从配置环境变量读取的 bearer key 调 `/images/generations`；缺 key 是指名环境变量的响亮执行期错误。两条后端都经 `attachments.saveImage` 落库，其解码与图片限制始终权威；提供方应答可能是图片 URL（服务端下载）或内联 base64。Web 卡片行覆盖调用的每种形态——运行中、被拒、已完成——因为键控视图的认领会抑制通用兜底。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [attachment 包](../../attachment/attachment-local/README.zh.md) —— 每张图片卡片背后的持久库。
- [工具编写手册](../../../docs/cookbook/adding-a-tool.zh.md) —— 卡片行遵循的呈现契约。
- [image 组](../README.zh.md) —— 组地图。

-----

<a id="model-experience"></a>
## 模型体验

### generate_image 工具

#### 模型看到什么

装配时模型看到 `generate_image` 工具模式：`prompt` 字符串、可选的 `quality` 难度判断（`fast`/`fine`）、可选的 `size`（`WIDTHxHEIGHT`）。执行后它看到文本信封加作为图片内容块的图片本体；信封携带提示词、实际渲染的模型与档位、路由原因，以及让自动图片卡片承载图片、绝不把返回的存储路径粘进回复正文的指示。

#### token 影响

工具模式按会话静态，装配成本固定。每次调用只增加自己的参数、信封文本和当轮的图片块；图片在文本上下文之外，回放只需同样的信封，不必重新内联图片字节。

#### KV 缓存影响

模式与信封不变使请求字节跨轮稳定；逐轮只有调用结果块不同，因此会话内多次调用之间、以及工具集相同的跨会话之间，缓存前缀都得以保留。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

以下为当前包约束。

- 不设 `comfyuiDir` 时后端假设 `comfyuiUrl` 上的服务在跑且模型已下载；设置后首图延迟包含服务启动，ComfyUI 队列等待计入 `timeoutMs`。共享服务上的精细档渲染会把快速检查点挤出显存，下一次快速档渲染需付出重载代价。
- 暂未暴露采样器、选种子或负向提示词控制；两条图都固定 euler/simple、denoise 1，负向提示词为空。
- `openai-images` 后端继承提供方实施的尺寸与内容策略；`size` 是请求默认值，不是保证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

ComfyUI 后端为消费级产品 fork 而加（2026-10-04 用户指示）：本地 SDXL-Turbo 取代云端默认。双档路由对接本地 Qwen-Image GGUF 模型（2026-10-08 用户指示）：模型经 `quality` 表达难度，宿主经探测的空闲资源否决，`auto` 交由宿主余量定夺。`openai-images` 后端保留为可移植兜底。两个面同包交付；client 半边经 `dsh.client.inject` 注册。

</details>
