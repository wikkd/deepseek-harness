---
description: "Choose Agent presets and the new-task default in Web, read what each mode does and what it declares. The consumer fork locks the roster to its declared modes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

English | [中文](README.zh.md)

## Summary

Choose Agent presets and the new-task default in Web, read what each mode does and what it declares. The consumer fork locks the roster to its declared modes; no authoring surface exists.

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

Settings shows the built-in and custom card groups with default highlighting and card-body selection; a group without presets is omitted. Every card offers “View configuration”, which opens the preset's declared plugin list as read-only YAML in the Loader's own dialect (`!!js` conditions included); a failed preset stays readable because its diagnostic points into that YAML. Escape closes only the viewer and returns focus to its card; leaving Settings clears the viewer, and a late read does not reopen it. The page edits nothing: the consumer fork registers no Creator entry, so the custom group renders only while user-authored presets exist, and none can be created in the product.

The new-session picker and Settings roster offer the profile's declared modes; with Coding Tools off in General Settings, coding-gated presets (PTC, Minimal) hide. Default selection remains available in both states. Choosing a healthy default also synchronizes the blank session on the current new-task surface.

Turning Coding Tools off clears all unapplied choices through the existing Developer tools subscription. Once the off value is accepted, a host-backed connection resets a saved built-in PTC or Minimal default to Standard. Saved Standard, Creator, and custom defaults (including named PTC or Minimal overrides) stay unchanged. The user can select an available preset again after turning Coding Tools off. Existing sessions, including blank sessions reused by New Session, keep their selected mode; its label remains visible even when that mode is absent from the menu. Turning Coding Tools back on does not restore the old default or cleared choice. A remote connection using in-memory settings does not rewrite the Host's default. If Standard is missing or broken, the default remains unchanged and an error is shown.

Known shipped presets offer mode details and usage examples in a read-only dialog. Its tabs preserve each page's scroll position; closing returns focus to the opening action. Help does not change the new-task default. The default badge replaces the card's group badge, and the preset id appears beside the title. Guide copy and examples belong to this package.

The Plugins page's **Add plugin** arrow menu carries no Creator entry in the consumer fork: apply registers nothing into `plugins.add.actions`. A preset-switch refusal still surfaces through the shared Toast.

Entering Creator selects `cordis` for the receiving blank Session without changing the new-task default or Coding Tools setting. If no workspace or blank Session is bound yet, the choice waits for that binding. After the choice is applied, the Creator Session keeps its preset; a later newly created Session uses the configured default, such as Standard.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`agentPresets/list` supplies the roster and marks the current default, and `agentPresets/read` one declaration's YAML for the viewer; default changes write the `agent-preset-registry` settings namespace. The picker, blank-session synchronization and read-only session label use recorded preset identities. Connection resets and settings updates refresh the roster.

The fork's apply registers no `plugins.add.actions` entry: preset authoring is locked to the declared roster (2026-10-06 user directive), so `CreatePluginMenuItem` ships unused. The same `startCreatorDraft` callback stays exposed to Settings as `creatorDraft` and only activates while the `cordis` preset is on the roster. `AgentPresetSeat` renders refusals through the shared `Toast` component.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Scope](../../core/scope/README.md) — Registration isolation.
- [Agent](../../core/agent/README.md) — Session runtime.
- [Cordis](../../../docs/cordis-primer.md) — Plugin configuration and lifecycle.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected preset, whose plugins own model-visible capabilities.

#### KV Cache effect

Selection changes affect only later tasks; existing plugins and prompts remain unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Web creates and edits no preset: the configuration viewer is read-only, and a bundle installed through Creator mode declares a new preset or overrides a shipped one by row id, replacing its complete child list.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
