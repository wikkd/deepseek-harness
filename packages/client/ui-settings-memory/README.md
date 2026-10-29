---
description: "The Memory page in Settings: first-run consent, an availability switch, explicit add/edit/delete/clear controls, and the generated remote.memory client wiring."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-memory

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-memory` adds the Memory page under Settings: first-run consent, one availability switch, an add form with a kind selector, and per-entry edit and delete plus clear-all. It reads and mutates the Host memory service through the generated `remote.memory` namespace and never touches storage. The Host half is an empty loadable plugin so the browser bundle is injected; the page appears only when the Web settings shell is present.

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

Mount the package as one Host row; the browser half registers itself into the `settings.section` slot. The page has no configuration fields.

```yaml
- id: ui-settings-memory
  name: '@deepseek-ai/dsh-client-ui-settings-memory'
```

The client plugin injects `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-settings`, and `@deepseek-ai/dsh-api-remotes`, and requires `remote.memory` from the Host provider.

### First-run consent

Before consent, the page shows a card explaining that memories stay on this computer. The single action records consent and enables memory. No entry can be saved and no model tool is visible before that action completes.

### Daily controls

- The switch enables or disables the model-facing memory surface. Disabling keeps entries visible and stored; the page states they are no longer given to the assistant.
- The add form takes one sentence and a kind (`About you`, `Preference`, or `Other fact`). A successful save clears the field.
- Each entry shows its kind and text, with Edit and Delete. Edit replaces the text only; the kind is unchanged.
- Clear all requires a second confirmation click (`Clear everything`) and has no undo.

### Errors and busy state

The first read shows `Reading memories…`; a failed read shows `Try again`. Every mutation disables the controls while it runs and serializes behind earlier mutations. A Host rejection appears in an alert above the list; the page keeps the previous snapshot.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the browser object layer and registration; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design choices

- **One controller, one snapshot.** `MemorySectionController` owns the page state in a snapshot store and refreshes it from the Host after mutations.
- **Consent is two durable writes.** The consent action calls `setConsent(true)` and then `setEnabled(true)`; a failure between them leaves the page showing the Host's authoritative state on the next read.
- **Remote only.** The page never reads the JSON file or imports the provider; `remote.memory` is the only data path.
- **Locale-owned copy.** Both dictionaries live in `locales.ts`; the slot supplies the namespace and labels.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host half: an empty plugin so the package can load in Host compositions |
| [`src/client/index.ts`](src/client/index.ts) | Settings-section registration, dictionaries, injected actions |
| [`src/client/controller.ts`](src/client/controller.ts) | Snapshot state, first read, serialized mutations, error messages |
| [`src/client/MemorySection.tsx`](src/client/MemorySection.tsx) | Consent card, switch, add form, entry list, clear confirmation |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese copy |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [memory group map](../../memory/README.md) — the contract, provider, tools, and this page together.
- [Local provider](../../memory/memory-local/README.md) — the durable state behind `remote.memory`.
- [Model-facing tools](../../memory/tool-memory/README.md) — what the switch makes visible to the model.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory) — the `memory_*` schemas the model receives.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory-local) — provider and prompt bounds shown here through defaults.

-----

<a id="model-experience"></a>
## Model Experience

None, as this is a browser settings surface whose writes are owned by the Host memory service and its model-facing tool plugin.

#### KV Cache effect

None; the page changes no request directly, and a settings write affects the prefix only through the provider and tool plugins.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No search or pagination** — the page renders every entry returned by the snapshot; large stores become one long list.
- **Single delete has no confirmation** — only clear-all is armed with a second click.
- **Text-only edits** — an entry's kind cannot be changed from the page.
- **No undo** — a deleted entry or a cleared store cannot be restored here.
- **No consent withdrawal control** — the page can disable memory, but withdrawing consent requires the Host method or another surface.
- **No secret detection** — the page accepts whatever sentence the user submits; filtering is left to the user and the model tool's instructions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The page depends on the generated `remote.memory` client contribution in `@deepseek-ai/dsh-api-remotes`. Changing a Remote method or snapshot field requires regenerating that contribution and updating this controller in the same change. Product copy is locale-owned; add both dictionaries together.

</details>
