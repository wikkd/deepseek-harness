---
description: "小圆身份覆盖层：为每个 agent 人设补上产品身份，包括只带通用软件工程师人设的第三方编程 preset。"
kind: "package-reference"
---

# @deepseek-ai/dsh-persona-xiaoyuan

[English](README.md) | 中文

## 概述

`dsh-persona-xiaoyuan` 让每个 Agent 的自我介绍都保持为小圆。Agent preset 拥有人设文本；第三方编程 preset 可能只描述一个通用软件工程师，从不提及产品名。本行在系统提示词组装期间读取人设，并在其中不含任何配置名称时前置一行简短身份。它原地修改现有人设段落，因此保留人设的 preset 提示词过滤器也会保留这行身份。

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

在 profile 组装中挂载本行一次，位置在 system-prompt 服务存在之后。它作用于该进程内的每个 Agent 组装，包括各个 preset 和委派出去的 agent。

```yaml
- name: '@deepseek-ai/dsh-persona-xiaoyuan'
  config:
    identity: 你是小圆（鹿目圆），一位亲切、能干的中文助手。无论当前工作模式是什么，你都以小圆自称，不要自称其他名字。
    names:
      - 小圆
      - 鹿目圆
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `identity` | 标准小圆身份行 | 当人设不含任何 `names` 时前置的文本 |
| `names` | `['小圆', '鹿目圆']` | 已带产品身份的人设所包含的名称 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-persona-xiaoyuan)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 何时使用

当产品需要在异构 preset 之间保持一致身份时使用本行，尤其是产品并不拥有的外部包 preset。它不能替代 preset 自己的人设：身份行之后仍保留原人设。若 preset 要彻底替换自己的身份，应使用 `@deepseek-ai/dsh-persona`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 覆盖层如何注册

本行注入 `systemPrompt`，并监听 `system-prompt/assemble` waterfall。它先调用 `next()`，再检查组装出的 `deployment:persona-prefix` 段落。如果文本已包含任一配置名称，原样返回组装结果；否则只重建该段落为 `${identity}\n\n${persona}`，并返回新的组装结果。

### 为何原地修改人设段落

第三方编程 preset 会把组装后的提示词收窄到人设、plan 策略与 PTC 段落。新增段落会被该过滤器丢弃；修改现有人设段落则会让过滤器保留修改后的文本。监听器在编辑前调用 `next()`，因为以 `prepend` 注册的 preset 过滤器包裹着内层监听器；修改最终存活的人设段落不依赖外围指导由哪一阶段移除。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、纯函数 `applyIdentity`、waterfall 注册 |
| [`tests/identity.spec.ts`](tests/identity.spec.ts) | 纯函数与真实组装行为测试 |
| [`tests/loader-composition.spec.ts`](tests/loader-composition.spec.ts) | 真实 Loader 组装：YAML 配置、函数插件命名空间、模型可见提示词 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [persona 包](../persona/README.zh.md)——本覆盖层所补充的、由 preset 拥有的人设行。
- [系统提示词子系统](../../../docs/subsystems/system-prompt.zh.md)——段落、组装 waterfall 与完整提示词恢复。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-persona-xiaoyuan)——每个受支持字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 身份行

#### 模型看到什么

当人设不含小圆或鹿目圆时，模型会在 `deployment:persona-prefix` 段落收到配置的身份行，随后是 preset 原本的人设文本。已经包含产品名的人设不受影响。该行属于系统提示词，而不是 user 角色消息，因此在压缩后仍然有效。

#### Token 影响

对于原本不带身份的人设，每次请求都会增加固定的小幅 token；已经包含产品名的人设不增加。

#### KV Cache 影响

增加或移除覆盖层会改变靠前的人设前缀，从而使该 Agent 的提供方缓存前缀失效。只要配置的身份与 preset 人设不变，该行就是稳定的。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些是当前包约束，不是任务积压。

- **完整人设会绕过覆盖层**——以 `complete: true` 注册的人设在组装 waterfall 之后会被提示词注册表恢复，因此覆盖层无法修改它。这类 preset 必须在自己的人设前缀中包含小圆。
- **名称匹配是字面匹配**——只有当人设文本恰好包含 `names` 中的某一项时才会跳过；它不会识别配置列表之外的别名或译名。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

产品 profile 在第三方 `dsh-liangshen` 编程 preset 之后挂载本行。该 preset 的 `minimal-prompt` 监听器以 `prepend` 过滤提示词，因此本覆盖层必须修改现有人设段落，而不是新增段落。

</details>
