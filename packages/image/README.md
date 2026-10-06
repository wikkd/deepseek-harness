---
description: "The image group map: image-generation model tools, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/image

English | [中文](README.zh.md)

## Summary

The image family turns text prompts into pictures through model-provider tools. Packages in this group register model-facing tools whose results commit to the durable attachment store, so a generated picture renders as a replayable card in every surface without provider-specific plumbing. Choose this family for product surfaces that create images; it requires the attachment store and the tool registry, and it exposes no session events to the model beyond the tool's own result.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`image-gen`](image-gen/README.md) | Registers `generate_image` over a local ComfyUI server or an OpenAI-compatible images API | consumes `ctx.tools`, `ctx.attachments` |

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Group packages must keep the two-part contract: a model-facing tool plus a keyed web card row, with bytes committed only through the attachment store so replays never need the provider.

</details>
