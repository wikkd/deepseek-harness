---
description: "Live2D desktop pet (@deepseek-ai/dsh-client-ui-live2d-avatar): a draggable madoka avatar floating over the web conversation, speaking with lip sync and mirroring each reply's emotion."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-live2d-avatar

English | [中文](README.zh.md)

## Summary

This package puts the consumer fork's mascot on screen: a Live2D madoka model floats at a corner of the conversation view, draggable, with idle motions, click-triggered actions, lip sync while the TTS plugin speaks, and expression mirroring of each reply's classified emotion. Preferences (visibility, height, opacity, anchor, motion rate, lip sync, expression mirroring) are volatile settings edited live from the Web settings page; position memory lives in localStorage.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile patch layer; the browser half registers through the composed Web client's plugin bundle. The model assets and Cubism Core are served from the web app's static directory.

### When to choose it

Choose it for any deployment that wants the pet companion. Without the emotion-express package the pet still renders, moves, and lip-syncs; expression mirroring simply stays at its default-off preference until both halves are mounted.

### Minimal configuration

```yaml
- insert:
    - id: ui-live2d-avatar
      name: '@deepseek-ai/dsh-client-ui-live2d-avatar'
```

Runtime preferences are volatile fields (visibility, height, opacity, anchor, motion rate, lip sync, expression mirroring) edited from Settings → 小圆桌宠 in the web client.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half renders the model through pixi.js and pixi-live2d-display-lipsyncpatch: idle motions loop on a rate setting, clicks trigger random actions, and the lip-sync path proxies the audio element so the model's mouth parameter follows the TTS playback; speaking pauses ambient motion. Expression mirroring listens for the emotion-express package's window event and maps each emotion key to one of the model's expression files by name, validating the name against the model's declared expressions and restoring the ambient state on neutral. A settings change restarts the pet's render loop cleanly; teardown disposes every listener and subscription in reverse order.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Emotion-express package](../ui-emotion-express/README.md) — the classifier that broadcasts the emotion this pet mirrors.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits describe current package constraints.

- The model artwork and its expression-to-emotion mapping are tuned for the bundled madoka model; another Live2D model needs its expression names re-mapped in the settings defaults.
- The pet renders only inside the web client's viewport; a desktop-shell always-on-top companion window is deferred to the desktop packaging milestone.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Created for the consumer product fork (user directive, 2026-10-06); lip sync followed on the voice milestone, and expression mirroring on the emotion milestone (2026-10-07). The model and Cubism Core ship from the web app's static directory, mirroring how other binary assets reach the browser without a plugin-owned URL surface.

</details>
