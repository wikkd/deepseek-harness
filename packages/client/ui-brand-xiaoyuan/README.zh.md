---
description: "小圆产品品牌占用者：填充 Web 客户端侧边栏与 hero 品牌 slot，是消费级 fork 的替换品牌包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-xiaoyuan

[English](README.md) | 中文

## 概述

本包为消费级 fork 提供产品身份：把侧边栏的标记与名称 slot 填成内置的「小圆」圆形头像和随语言变化的字标——不带版本号——并以同样方式接管空会话 hero 的标记。部署身份是「小圆」产品时选它；官方 DeepSeek Harness 品牌包是 DeepSeek 品牌构建的对应物。本包无运行时状态，不影响模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 补丁层挂载插件；浏览器半边经组合后的 Web 客户端 slot 名册注册。

### 何时选择它

部署身份是小圆产品而非 DeepSeek Harness 时选它；官方品牌包是 DeepSeek 品牌构建的对应物。不要两者叠加：名称 slot 的每个占用者都会替换兜底，挂两个品牌包时最后一个生效。

### 最小配置

```yaml
- insert:
    - id: ui-brand-xiaoyuan
      name: '@deepseek-ai/dsh-client-ui-brand-xiaoyuan'
```

这些 slot 没有配置字段；显示的名称来自本包的语言字典（`小圆` / `Xiaoyuan`），两个标记渲染内置的圆形头像图。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

浏览器半边认领侧边栏的标记与名称 slot 加对话 hero 标记：两个标记位把内置圆形头像以 data URL 渲染，名称渲染一个随语言变化的 span；本占用者注册期间，侧边栏的本地构建兜底（名称加版本号）不再渲染。语言字典是键集的权威来源，文案由 i18n 门禁把关。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [官方品牌包](../ui-brand-official/README.zh.md) —— 本包在 fork 中替换的 DeepSeek 品牌对应物。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

以下为当前包约束。

- 头像图以内置 data URL 分发；专属矢量标记与产品级字体排印（字体、间距）延期到桌面打包里程碑。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

为消费级产品 fork 的品牌化而建（2026-10-05 用户指示）：面向操作者的外壳不得出现 DSH 本地构建品牌。标记图是运营者提供的头像（2026-10-06）；生成的素材系列存放在产品主目录的 brand 目录下。官方品牌包的 README 写明了这个替换角色。

</details>
