---
description: "The memory group map: the long-term memory contract, the local durable provider, and the model-facing tools and prompt section, for users and maintainers navigating the group."
kind: "package-group"
---

# memory/ — long-term memory capability family

English | [中文](README.zh.md)

## Summary

The memory group gives the assistant durable, user-controlled long-term memory. It splits into the shared contract (`memory`), a local JSON-backed provider (`memory-local`), and the model-facing tools and bounded prompt section (`tool-memory`). The settings page lives in [`client/ui-settings-memory`](../client/ui-settings-memory/README.md) and uses the generated `remote.memory` namespace. Memory starts off and unconsented; the user must opt in before any entry is stored or any memory tool becomes visible to the model.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory`](memory/README.md) | Defines the entry vocabulary, consent state, service contract, and settings-change event | `ctx.memory` (declaration) |
| [`memory-local`](memory-local/README.md) | Stores consent, availability, and entries in the product data home and exposes the settings Remote | provides `ctx.memory` |
| [`tool-memory`](tool-memory/README.md) | Registers `memory_save`, `memory_search`, `memory_forget`, and the bounded prompt section while memory is active | registers on `ctx.tools` and `ctx.systemPrompt` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Long-term memory subsystem](../../docs/subsystems/memory.md) — entry identity, consent and availability, snapshots, failures, and the generated Cordis API.
- [Local long-term memory Agent Note](../../.agents/notes/implemented/architecture/2026-10-22-local-long-term-memory.md) — why memory is local-only, explicit, and consent-gated.
- [Memory settings page](../client/ui-settings-memory/README.md) — the browser consent, toggle, and entry-management surface.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-memory) — the exact `memory_*` schemas the model receives.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-memory-local) — the provider and tool prompt bounds.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
