---
description: "image 组地图：面向用户与维护者的生图模型工具导航。"
kind: "package-group"
---

# packages/image

[English](README.md) | 中文

## 概述

image 家族把文字提示词经模型提供方工具变成图片。组内包注册面向模型的工具，结果统一提交到持久附件库，因此生成的图片在所有界面都以可回放卡片呈现，无需任何提供方专属管线。需要「会画图」的产品界面时选这一族；它依赖附件库与工具注册表，除工具自身结果外不向模型暴露任何会话事件。

## 目录

- [包列表](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包列表

| 包 | 职责 | ctx key |
|---|---|---|
| [`image-gen`](image-gen/README.zh.md) | 经本地 ComfyUI 服务或 OpenAI 兼容 images API 注册 `generate_image` | 消费 `ctx.tools`、`ctx.attachments` |

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

组内包必须保持两段式契约：面向模型的工具加按名键控的 Web 卡片行，字节只经附件库提交，回放永不依赖提供方。

</details>
