---
description: "小圆 product brand occupants for the Web client's sidebar and hero brand slots; the consumer fork's replacement brand package for maintainers and operators."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-xiaoyuan

English | [中文](README.zh.md)

## Summary

This package gives the consumer fork its product identity: it fills the sidebar's mark and name slots with the bundled circular 小圆 avatar and the locale-driven wordmark — no version badge — and takes over the blank-session hero mark the same way. Choose it for deployments branded as the 小圆 product; the official DeepSeek Harness brand package remains the counterpart for DeepSeek-branded builds. It has no runtime state and does not affect model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile patch layer; the browser half registers through the composed Web client's slot roster.

### When to choose it

Choose it when the deployment's identity is the 小圆 product rather than DeepSeek Harness; the official brand package is the DeepSeek-branded counterpart. Avoid stacking both: each occupant of the name slot replaces the fallback, so mounting two brand packages makes the last one win.

### Minimal configuration

```yaml
- insert:
    - id: ui-brand-xiaoyuan
      name: '@deepseek-ai/dsh-client-ui-brand-xiaoyuan'
```

The slots have no config fields; the displayed name comes from this package's locale dictionary (`小圆` / `Xiaoyuan`), and the two marks render the bundled circular avatar artwork.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The client half claims the sidebar mark and name slots plus the conversation hero mark: the two mark seats render the bundled circular avatar as a data URL, and the name renders one locale-driven span, so the sidebar's local-build fallback (name plus version badge) never renders while these occupants are registered. The locale dictionary is the key-set source of truth, so the i18n gate owns the copy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Official brand package](../ui-brand-official/README.md) — the DeepSeek-branded counterpart this package replaces in the fork.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits describe current package constraints.

- The avatar artwork ships as a bundled data URL; a dedicated vector mark and a product type treatment (font, spacing) are deferred to the desktop packaging milestone.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Created for the consumer product fork's branding pass (user directive, 2026-10-05): the operator-facing shell must not show DSH local-build branding. The mark artwork is the operator-provided avatar (2026-10-06); the generated asset series lives under the product home's brand directory. The official brand package's README names this replacement role.

</details>
