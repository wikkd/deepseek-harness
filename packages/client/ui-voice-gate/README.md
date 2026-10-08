---
description: "Voice-sync gate (@deepseek-ai/dsh-client-ui-voice-gate): holds finished streaming paragraphs invisible until their spoken audio is ready, so text and speech arrive together."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice-gate

English | [中文](README.zh.md)

## Summary

This package removes the read-ahead gap in spoken conversations: while the dsh-tts plugin speaks a reply, each finished streaming paragraph is held invisible until its spoken audio is ready, so the user hears a sentence as it first appears instead of reading past a silent screen. It configures itself through the dsh-tts plugin it observes and has no preference surface of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile patch layer beside dsh-tts; the browser half registers through the composed Web client's plugin bundle.

### When to choose it

Choose it whenever dsh-tts speaks replies in the deployment. Without dsh-tts the gate never engages: no speaking state means no hold, and the conversation renders normally.

### Minimal configuration

```yaml
- insert:
    - id: ui-voice-gate
      name: '@deepseek-ai/dsh-client-ui-voice-gate'
```

The plugin has no config fields; it follows the dsh-tts plugin's speak-replies state.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The gate is DOM-level on purpose: it observes the chat view's streaming prose marker and toggles a data attribute that one injected stylesheet turns into `visibility: hidden`. Layout is preserved, so scroll position and the turn rail stay put. Readiness comes from the same signals the dsh-tts player consumes: the TTS stream's utterance and error events plus a pending poll as reconnect backfill. A hold released by neither signal opens on its own after a timeout, so a broken TTS chain degrades to the ungated view instead of hiding prose forever.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-tts](https://www.npmjs.com/package/@goodandready/dsh-tts) — the speech plugin whose playback state drives the gate.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits describe current package constraints.

- The gate keys on the chat view's streaming marker, so a chat reimplementation that renames the marker needs this package's selector updated in lockstep; there is no exported contract for it yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Created for the consumer product fork's voice milestone (user directive, 2026-09): the barge-in-style passive listening of the TTS player left text visibly ahead of speech. The node half only disables the auto-generated settings page; all behavior lives in the browser half.

</details>
