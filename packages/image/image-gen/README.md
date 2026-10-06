---
description: "generate_image tool (@deepseek-ai/dsh-image-gen): text-to-image over a local ComfyUI server or an OpenAI-compatible images API, attachment-backed picture card in the web conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-image-gen

English | [中文](README.zh.md)

## Summary

Use this package when the agent should draw. The model-facing `generate_image` tool sends a prompt to the configured backend — a local ComfyUI server (no key, pictures never leave the machine) or an OpenAI-compatible images API — downloads the picture, commits it to the durable attachment store, and returns a structured value whose render pairs a text envelope with the image content block. The web conversation renders the settled call as a picture card keyed to the tool name; replays resolve the picture through the session-authorized attachment loader, so no provider URL or key reaches the browser.

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

Mount the plugin in a profile patch layer with the attachment store present; the dual-face package brings its own web card row.

### When to choose it

Choose it for any conversation surface that should produce pictures. The ComfyUI backend fits local privacy and keyless operation but needs a running ComfyUI with the checkpoint in place; the `openai-images` backend fits hosted deployments and reads its key from an environment variable at execution time. Without a durable image store the tool does not register.

### Minimal configuration

```yaml
- insert:
    - id: image-gen
      name: '@deepseek-ai/dsh-image-gen'
      config:
        backend: comfyui
        comfyuiDir: D:/path/to/ComfyUI
```

| Field | Default | Meaning |
|---|---|---|
| `backend` | `'comfyui'` | Generation backend; `comfyui` drives the local server without a key, `openai-images` calls an OpenAI-compatible API. |
| `comfyuiUrl` | `http://127.0.0.1:8188` | Local ComfyUI server origin. |
| `comfyuiCheckpoint` | `sd_xl_turbo_1.0_fp16.safetensors` | Checkpoint name under ComfyUI `models/checkpoints`. |
| `comfyuiSteps` | `2` | ComfyUI sampler steps; turbo checkpoints need 1-4. |
| `comfyuiCfg` | `1` | ComfyUI CFG guidance; turbo checkpoints want ~1. |
| `comfyuiDir` | `''` | Absolute ComfyUI checkout directory (`main.py` at its root). Set it to let the plugin spawn and supervise the server; empty leaves server management to the operator. |
| `comfyuiPythonPath` | `''` | Python interpreter that runs ComfyUI; empty uses `<comfyuiDir>/python_embeded`. |
| `comfyuiStartupTimeoutMs` | `120000` | Deadline for one managed ComfyUI startup. |
| `comfyuiExtraArgs` | `''` | Extra ComfyUI CLI arguments appended verbatim (whitespace-split). |
| `baseUrl` | `https://api.siliconflow.cn/v1` | OpenAI-compatible images API origin; `/images/generations` is appended. `openai-images` backend only. |
| `model` | `black-forest-labs/FLUX.1-schnell` | Text-to-image model id the provider routes. `openai-images` backend only. |
| `apiKeyEnv` | `IMAGE_GEN_API_KEY` | Environment variable holding the provider API key. `openai-images` backend only. |
| `size` | `1024x1024` | Default picture size as WIDTHxHEIGHT pixels. |
| `timeoutMs` | `120000` | Deadline for one generation request plus picture download. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-image-gen) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tool registers inside a `ctx.inject(['attachments'])` scope: no durable image store, no tool. The ComfyUI backend posts a fixed checkpoint-to-SaveImage graph to `/prompt`, polls `/history` until the job errors or emits a picture, and downloads through `/view`. With `comfyuiDir` set the plugin also owns the server's lifecycle: it spawns `main.py` on the loopback origin when nothing answers, shares one startup across concurrent renders, respawns a crashed server on the next picture, and kills the child when the profile stops; a broken checkout or interpreter fails the load loudly. The `openai-images` backend posts `/images/generations` with a bearer key read from the configured environment variable; a missing key is a loud execution-time error naming the variable. Both backends commit bytes through `attachments.saveImage`, whose decode and image limits stay authoritative; the provider answer may carry a picture URL (downloaded server-side) or inline base64. The web card row covers every call shape — running, refused, and settled — because claiming the keyed view suppresses the generic fallback.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Attachment package](../../attachment/attachment-local/README.md) — the durable store behind every picture card.
- [Tool authoring cookbook](../../../docs/cookbook/adding-a-tool.md) — the presentation contract the card row follows.
- [Image group](../README.md) — the group map.

-----

<a id="model-experience"></a>
## Model Experience

### generate_image tool

#### What the model sees

At assembly the model sees the `generate_image` tool schema: a `prompt` string plus an optional `size` (`WIDTHxHEIGHT`). After execution it sees a text envelope together with the picture itself as an image content block; the envelope instructs the model to let the automatic picture card carry the image and never to paste the returned storage path into reply text.

#### Token effect

The tool schema is static per session, so assembly cost is fixed. Each call adds only its own arguments, the envelope text, and that turn's image block; pictures stay outside the text context, so a replay costs the same envelope without re-inlining image bytes.

#### KV Cache effect

An unchanged schema and static envelope keep request bytes stable across turns; only the per-call result block differs, so the cached prefix survives between calls within one session and across sessions with the same tool set.

## Known Limitations and Deferred Work

These limits describe current package constraints.

- Without `comfyuiDir` the backend assumes a running server at `comfyuiUrl` with the checkpoint already downloaded; with it, first-picture latency includes the server start, and queue waits inside ComfyUI count against `timeoutMs`.
- No sampler, seed, or negative-prompt controls are exposed yet; the graph fixes euler/simple with denoise 1 for turbo checkpoints.
- The `openai-images` backend inherits whatever size and content policy the provider enforces; `size` is a request default, not a guarantee.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The ComfyUI backend was added for the consumer product fork (user directive, 2026-10-04): local SDXL-Turbo replaced the cloud default. The `openai-images` backend stays the portable fallback. Both faces ship from one package; the client half registers through `dsh.client.inject`.

</details>
