---
description: "Emotion-express bridge (@deepseek-ai/dsh-client-ui-emotion-express): classifies each settled assistant reply and broadcasts the emotion on a window event the Live2D pet consumes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-emotion-express

English | [中文](README.zh.md)

## Summary

This package gives the consumer fork's desktop pet its emotional expression: as each assistant reply settles, the browser half classifies its visible text into one of five emotions (happy, angry, sad, surprised, neutral) with a rule-based lexicon and punctuation cues, then broadcasts a `dsh-emotion:expression` window event. The Live2D avatar package consumes the event and sets the matching expression. It affects no model requests and stores nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile patch layer alongside the Live2D avatar package; the browser half registers through the composed Web client's plugin bundle.

### When to choose it

Choose it when the deployment's pet should mirror the reply's tone. Without a consumer of the `dsh-emotion:expression` event the plugin is inert: classification runs and events dispatch, but nothing visible changes.

### Minimal configuration

```yaml
- insert:
    - id: ui-emotion-express
      name: '@deepseek-ai/dsh-client-ui-emotion-express'
```

The plugin has no config fields; classification is automatic on every settled assistant reply.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half subscribes to the main-view session's event source through the sessions service, classifies the visible text blocks of each settled `assistant/message` (interrupted replies are skipped), and dispatches a window CustomEvent whose detail carries the emotion key and a monotonic sequence number. The sequence deduplicates reordered replays; a change of the main-view session re-arms the subscription. The classifier scores a weighted lexicon (Chinese and English) plus punctuation and emoticon cues, taking the highest score with ties resolving to neutral. The event name and payload shape are declared once here and consumed structurally by the avatar package — no cross-package runtime dependency.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Live2D avatar package](../ui-live2d-avatar/README.md) — the pet that consumes the expression event.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits describe current package constraints.

- The rule-based classifier trades recall for zero cost: sarcasm, mixed-tone replies, and vocabulary outside the lexicon classify as neutral. A model-based classifier is the planned successor; this rule path remains the fallback when the model is unavailable or low-confidence.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Created for the consumer product fork (user directive, 2026-10-07) as plan B of the emotion-expression design note: the rule classifier ships first, the event channel and mapping layer are built to survive the later model-based replacement. The node half is a no-op kept for the Service Definition convention; all behavior lives in the browser half.

</details>
