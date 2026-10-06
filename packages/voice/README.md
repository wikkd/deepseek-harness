---
description: "The voice group map: sidecar voice stacks that spawn and manage local TTS engines for the host profile."
kind: "package-group"
---

# packages/voice

English | [中文](README.zh.md)

## Summary

The voice group hosts sidecar voice stacks: plugins that spawn and manage local speech engines whose lifetime rides on the host profile. Each package exposes its engine through a documented provider seam (today the dsh-tts `custom` provider) and owns the child process, ports, and transcode plumbing behind it. Choose this group when a local synthesis engine must start with the profile and stop with it; the engine itself stays a config-pointed external checkout, never a bundled dependency.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`gptsovits-voice`](gptsovits-voice/README.md) | GPT-SoVITS api_v2 sidecar plus OpenAI-compatible TTS bridge | consumes `ctx.logger`, registers no service |

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Packages here are deliberately machine-deployment-shaped: every path and port is a config field, and the group never hardcodes an engine location. Engines added later should follow the same seam — a provider the dsh-tts chain can address plus a managed child process.

</details>
