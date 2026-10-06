---
description: "GPT-SoVITS sidecar (@deepseek-ai/dsh-gptsovits-voice): hosts the OpenAI-compatible TTS bridge and manages the local api_v2 child process for cloned-voice synthesis."
kind: "package-reference"
---

# @deepseek-ai/dsh-gptsovits-voice

English | [中文](README.zh.md)

## Summary

Use this package when the dsh-tts `custom` provider should speak with a cloned GPT-SoVITS voice. The plugin serves `POST /v1/audio/speech` in the OpenAI audio-speech shape on a local bridge port, synthesizes through a managed GPT-SoVITS api_v2 child process, and transcodes the wav answer to mp3 with bundled `ffmpeg-static`. The api_v2 process spawns when the profile boots (if the port is free) and dies with the profile; no manual engine scripts. Every path, port, and voice profile is a config field.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile patch layer and point the dsh-tts chain's first entry at `custom` with `customBaseUrl http://127.0.0.1:<bridgePort>/v1`.

### When to choose it

Choose it when a GPT-SoVITS checkout with trained voice weights exists on the machine and cloned-voice replies matter more than cloud TTS simplicity. Avoid it when no local checkout exists — the plugin configures and supervises the engine but never ships it; the dsh-tts chain then slides to its next provider on failure.

### Minimal configuration

```yaml
- insert:
    - id: gptsovits-voice
      name: '@deepseek-ai/dsh-gptsovits-voice'
      config:
        gptsovitsDir: D:/path/to/GPT-SoVITS
```

| Field | Default | Meaning |
|---|---|---|
| `gptsovitsDir` | `''` | Absolute GPT-SoVITS checkout directory (`api_v2.py` sits at its root). |
| `pythonPath` | `''` | Python interpreter for api_v2; empty uses the checkout `.venv`. |
| `host` | `127.0.0.1` | Host both api_v2 and the bridge bind to. |
| `apiPort` | `9880` | Port of the GPT-SoVITS api_v2. |
| `bridgePort` | `9885` | Port of the OpenAI-compatible bridge. |
| `apiConfigPath` | `GPT_SoVITS/configs/tts_infer_dsh.yaml` | api_v2 TTS config path, relative to `gptsovitsDir`. |
| `autostartApi` | `true` | Spawn api_v2 on profile boot. |
| `apiStartupTimeoutMs` | `180000` | How long to poll for api readiness before logging a timeout. |
| `requestTimeoutMs` | `180000` | Fetch timeout for one synthesis request. |
| `defaultVoice` | `''` | Voice used when a request names no profile or an unknown one. |
| `voices` | `[]` | Cloned-voice profiles: name, reference wav, prompt text, prompt/text language, auxiliary reference clips. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-gptsovits-voice) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bridge (`src/bridge.ts`) maps the requested `voice` to a configured profile, synthesizes through GPT-SoVITS `POST /tts` (injecting the reference clip and prompt text the api_v2 contract requires), detects the synthesis language per request (kana → ja, hangul → ko, han → zh, else en), and transcodes the wav answer to mp3 — dsh-tts treats every custom-provider response as `audio/mpeg`. The lifecycle owner (`src/index.ts`) spawns `api_v2.py` when `autostartApi` is on and the port is not already served, polls for readiness, forwards its output into the dsh logger, and on profile shutdown closes the bridge first, then kills the process.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Voice group](../README.md) — the sidecar seam this package implements.
- [dsh-tts](https://www.npmjs.com/package/@goodandready/dsh-tts) — the consumer whose `custom` provider calls the bridge.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits describe current package constraints.

- The GPT-SoVITS checkout, its weights, and a working GPU are machine prerequisites; the plugin validates reachability but cannot install any of them.
- One api_v2 process and one voice list per profile; concurrent synthesis batches serialize through the engine's own queue.
- Bridge authentication is pass-through: the local bridge does not verify the dsh-tts credential, so the port must stay loopback-bound.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Created for the consumer product fork's voice milestone (user directive, 2026-10-03): the engine must ride the profile lifecycle instead of a manually launched bat script. Engine-side specifics (weights pairing, prompt text) belong to the checkout, not this package.

</details>
