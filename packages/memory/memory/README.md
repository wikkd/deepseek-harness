---
description: "The long-term memory contract: entry kinds, consent and availability state, the ctx.memory service, and the settings-change event that adds or withdraws model tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

`dsh-memory` is the type and service contract for durable long-term memory: the entry vocabulary (`user`, `preference`, `fact`), consent and availability state, the `ctx.memory` service, and the `memory/settings-changed` event. Use it when you implement a provider, a model tool, or a settings surface; it contains no storage, tools, or model prompt. The local provider is [`memory-local`](../memory-local/README.md); the model-facing tools are [`tool-memory`](../tool-memory/README.md).

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

Import the contract from `@deepseek-ai/dsh-memory` in Host code and from `@deepseek-ai/dsh-memory/types` in browser code. The package has no plugin entry and no configuration; mounting a provider is what makes `ctx.memory` available.

### What it declares

- `MemoryEntry` and `MemoryId` identify one stored sentence and its stable identity.
- `MEMORY_KINDS` fixes the accepted categories: `user`, `preference`, and `fact`.
- `MemoryService` defines synchronous reads, durable mutations, consent, and availability.
- `MemoryError` carries a stable code (`not-ready`, `disabled`, `consent-required`, `blank`, `too-large`, `limit`, `duplicate`, `not-found`, `invalid-kind`) so callers render a specific recovery message.
- `memory/settings-changed` announces a durable settings change; tool and prompt owners add or withdraw their surface in response.

### Consent and availability

A fresh provider reports `consented: false` and `enabled: false`. Enabling requires recorded consent; withdrawing consent also disables availability. Disabling keeps entries and consent, so the user can turn the surface back on without re-consenting.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This package is a vocabulary and seam declaration. It deliberately owns no storage, no process, and no model registration; those belong to the provider and consumer packages.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Entry, settings, snapshot, service, error, and event declarations |
| [`src/index.ts`](src/index.ts) | Public runtime exports for the contract |

### Why reads are synchronous

`list()` and `snapshot()` return the provider's authoritative in-memory state. The local provider keeps that state next to its durable domain, so prompt assembly does not wait on disk. A provider backed by a remote service must cache a consistent copy locally rather than making the model wait on a network round trip.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [memory group map](../README.md) — the provider, tools, and settings page in one table.
- [Local provider](../memory-local/README.md) — durable JSON storage, bounds, and the settings Remote.
- [Model-facing tools](../tool-memory/README.md) — explicit save, search, forget, and the bounded prompt section.
- [Memory settings page](../../client/ui-settings-memory/README.md) — consent, toggle, and entry management.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory-local) — the provider and prompt bounds.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only declares the memory contract; the provider and tool packages own persistence and every model-facing contribution.

#### KV Cache effect

None; the contract neither assembles nor sends a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Contract only** — mounting this package provides no storage, no tools, and no prompt section; a provider and a tool consumer are required.
- **Explicit saves only** — the contract has no automatic conversation extraction or background learning path.
- **Synchronous reads** — a provider that cannot answer from local state cannot implement this seam without a cache.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
