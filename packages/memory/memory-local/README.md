---
description: "The local long-term memory provider: consent and availability state plus durable entries in the product data home, bounded by configurable count and length limits."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-local

English | [中文](README.zh.md)

## Summary

`dsh-memory-local` provides `ctx.memory` and stores memory in the product data home as a JSON domain under the shared storage stack. It owns the first-run consent gate, the availability switch, entry limits, exact-duplicate refresh, in-place edits, deletion, and the generated `remote.memory` settings methods. Nothing is sent off the machine, and no model call participates in a memory read or write. Mount it once per profile; the model tools and prompt section come from [`tool-memory`](../tool-memory/README.md).

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

Mount this row after the shared storage stack. The provider opens one storage domain and keeps reads synchronous from its durable in-memory state.

```yaml
- id: memory-local
  name: '@deepseek-ai/dsh-memory-local'
  config:
    maxEntries: 200
    maxEntryChars: 2000
```

| Field | Default | Meaning |
|---|---|---|
| `maxEntries` | `200` | Maximum retained entries; a new save is refused at the cap |
| `maxEntryChars` | `2000` | Maximum trimmed length of one entry in UTF-16 code units |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory-local) is the exhaustive source for accepted fields.

### First run and consent

A fresh domain reports `enabled: false` and `consented: false`. `setEnabled(true)` fails with `consent-required` until `setConsent(true)` is recorded. Withdrawing consent disables memory but keeps entries and consent removed; disabling alone keeps both consent and entries, so the user can turn the surface back on without repeating the consent step.

### What each operation does

`save()` trims the text, rejects blank or oversized input, and refreshes the kind and timestamp when an entry with exactly the same text already exists. A duplicate save preserves the original id and creation time. `update()` replaces text in place, preserves id and creation time, and rejects a missing target or text already used by another entry. `forget()` deletes by id and reports whether the entry existed. `clear()` removes every entry without changing consent or availability. Entries are listed newest-first, then by id for deterministic order.

### Storage and Remote

The domain lives at `<DSH_HOME>/storages/memory.json`, using the base bundle's `storage-json` root. `snapshot`, `setEnabled`, `setConsent`, `save`, `update`, `forget`, and `clear` are decorated for the generated `remote.memory` namespace, so the settings page reads and mutates the same authoritative state.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the provider keeps its durable state coherent; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design choices

- **One storage domain, one owner.** Consent and entries share the versioned `memory` domain, so a settings change and an entry write cannot land in different files.
- **Serialized mutations.** Every mutation queues on one promise chain; the cap cannot be exceeded by concurrent saves, and a failed mutation does not block later work.
- **Synchronous reads from durable state.** The domain's in-memory table is authoritative between writes, so prompt assembly never waits on disk or network.
- **Explicit deduplication.** Exact text is the duplicate key; a repeat save refreshes metadata instead of creating a second row.
- **Remote methods are the settings API.** `TypertRemoteService` decorates the Host methods; the browser settings page never writes storage directly.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service lifecycle, storage domain, mutations, bounds, Remote methods |
| [`src/spec.ts`](src/spec.ts) | Versioned domain specification, stored record schemas, and table/global layout |

### Shutdown

The service sets a stopping flag, waits for the active mutation chain, and closes the domain. Calls made after shutdown fail with `not-ready` instead of racing the close.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [memory group map](../README.md) — the contract, provider, tools, and settings page together.
- [Memory contract](../memory/README.md) — the service and error vocabulary this provider implements.
- [Model-facing tools](../tool-memory/README.md) — the prompt section and `memory_*` tools that consume this provider.
- [Memory settings page](../../client/ui-settings-memory/README.md) — consent, availability, edit, delete, and clear controls.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory-local) — every accepted field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `tool-memory`, which renders selected entries into its prompt section and exposes the memory tools.

#### KV Cache effect

Indirectly; a saved entry changes the prompt section only for requests assembled after the write, while an unchanged memory surface stays prefix-stable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Plain local JSON** — entries are stored unencrypted in the user's data home; the product does not claim at-rest encryption.
- **One application instance** — mutations serialize inside one Host process; two app instances sharing the same data home are not coordinated.
- **Exact-text duplicate only** — near-duplicates and rephrased facts create separate entries.
- **No migration or import** — a fresh domain starts empty; legacy `MEMORY.md`/`USER.md` files are not read.
- **Cap refuses new saves** — at `maxEntries`, an existing duplicate can still be refreshed, but a genuinely new entry fails with `limit`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Mutating a Remote method signature or return type requires regenerating the Remote artifacts and updating the settings client in the same change. The domain version is part of the durable file; treat a structural change as a persistence migration, not an in-place rewrite.

</details>
