---
description: "The 小圆 identity overlay that adds the product name to every agent persona, including third-party coding presets that ship a generic software-engineer identity."
kind: "package-reference"
---

# @deepseek-ai/dsh-persona-xiaoyuan

English | [中文](README.zh.md)

## Summary

`dsh-persona-xiaoyuan` keeps every Agent's self-introduction on 小圆. Agent presets own their persona text; a third-party coding preset may describe only a generic software engineer and never name the product. This row reads the assembled persona during the system-prompt waterfall and prepends one short identity line when the persona contains none of the configured names. It edits the existing persona section in place, so a preset prompt filter that keeps the persona also keeps the identity.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row once in the profile composition, after the system-prompt service exists. It applies to every Agent assembly in that process, including presets and delegated agents.

```yaml
- name: '@deepseek-ai/dsh-persona-xiaoyuan'
  config:
    identity: 你是小圆（鹿目圆），一位亲切、能干的中文助手。无论当前工作模式是什么，你都以小圆自称，不要自称其他名字。
    names:
      - 小圆
      - 鹿目圆
```

| Field | Default | Meaning |
|---|---|---|
| `identity` | The standard 小圆 identity line | Text prepended to a persona that contains none of `names` |
| `names` | `['小圆', '鹿目圆']` | Names that mark a persona as already carrying the product identity |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-persona-xiaoyuan) is the exhaustive source for every accepted field and its JSDoc.

### When to use it

Use this row when a product must keep one identity across heterogeneous presets, especially presets installed from another package that the product does not own. It is not a replacement for a preset's persona: the original persona remains after the identity line. Use `@deepseek-ai/dsh-persona` when a preset should replace its own identity outright.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### How the overlay registers

The row injects `systemPrompt` and listens on the `system-prompt/assemble` waterfall. It calls `next()` first, then checks the assembled `deployment:persona-prefix` section. If the text already contains one of the configured names, the assembly is returned unchanged. Otherwise the listener rebuilds only that section with `${identity}\n\n${persona}` and returns a new assembly.

### Why the persona section is edited in place

The third-party coding preset filters the assembled prompt down to the persona, plan policy, and PTC sections. A new section would be dropped by that filter. Modifying the existing persona section means the filter keeps the modified text. The listener calls `next()` before editing because preset filters registered with `prepend` run around the inner listeners; editing the surviving section is independent of which stage removes the surrounding guidance.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, pure `applyIdentity`, waterfall registration |
| [`tests/identity.spec.ts`](tests/identity.spec.ts) | Pure and real-assembly behavior tests |
| [`tests/loader-composition.spec.ts`](tests/loader-composition.spec.ts) | Real Loader composition: YAML config, function-plugin namespace, model-visible prompt |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [persona package](../persona/README.md) — the preset-owned persona row this overlay complements.
- [System prompt subsystem](../../../docs/subsystems/system-prompt.md) — sections, the assembly waterfall, and complete-prompt restoration.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-persona-xiaoyuan) — every accepted field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### The identity line

#### What the model sees

When a persona does not contain 小圆 or 鹿目圆, the model receives the configured identity line in the `deployment:persona-prefix` section, followed by the preset's original persona prose. A persona that already names the product is untouched. The line participates in the system prompt, not in a user-role message, so it remains in effect across compaction.

#### Token effect

A fixed small number of tokens on every request whose persona lacked the identity. Personas already naming the product add no tokens.

#### KV Cache effect

Adding or removing the overlay changes the early persona prefix and therefore invalidates the provider's cached prefix for that Agent. The line is stable while the configured identity and the preset persona are unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current package constraints, not a task backlog.

- **Complete personas bypass the overlay** — a persona registered with `complete: true` is restored by the prompt registry after the assembly waterfall, so the overlay cannot modify it. Such a preset must include 小圆 in its own prefix.
- **Name matching is literal** — the overlay skips a persona only when its text contains one of `names` exactly; it does not detect aliases or translated names outside the configured list.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The product profile mounts this row after the third-party `dsh-liangshen` coding preset. The preset's `minimal-prompt` listener filters the prompt with `prepend`, so this overlay must modify the existing persona section rather than contribute a new one.

</details>
