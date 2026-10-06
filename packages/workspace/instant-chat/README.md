---
description: "Instant chat (@deepseek-ai/dsh-instant-chat): guarantees a default workspace exists so the web GUI can start a conversation without the operator picking a directory first."
kind: "package-reference"
---

# @deepseek-ai/dsh-instant-chat

English | [中文](README.zh.md)

## Summary

Use this package when the web GUI must never dead-end on the workspace picker. At profile boot it checks `ctx.workspaceRegistry`; when the registry holds no workspaces it creates one under the harness home, so the client's recent-workspace restore connects a conversation immediately and the composer unlocks without any directory pick. A populated registry is left untouched. Creation failures are logged as warnings and never fail the boot; the workspace picker stays the manual fallback.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile patch layer; it needs no client half.

### When to choose it

Choose it for consumer-style deployments where the operator never picks a directory. Avoid it in developer profiles where an empty registry should surface the workspace picker; skip it when the shipped first-use initialization is acceptable — that built-in path only fires while registry and session history are both empty and permanently disables itself once its registration is deleted, which is exactly the dead end this plugin closes.

### Minimal configuration

```yaml
- insert:
    - id: instant-chat
      name: '@deepseek-ai/dsh-instant-chat'
      config: {}
```

| Field | Default | Meaning |
|---|---|---|
| `path` | `''` | Default workspace directory. Empty uses `<DSH_HOME>/workspaces/default`. `~` expands against the OS home; a relative path resolves against the host process cwd. |
| `title` | `'Default'` | Display title in the sidebar. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-instant-chat) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin injects the `workspaceRegistry` service and, in an `apply`-time check, creates the configured directory (`mkdir` recursive) and registers it when `registry.list()` is empty. `registry.create` is idempotent per canonical path, so coexisting with the built-in `initializeDefault` first-use flow is safe: whichever runs first owns the record, the other reuses it. The default path resolves through `@deepseek-ai/dsh-home-paths`, keeping the workspace under this fork's isolated home.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workspace package](../README.md) — the registry service this plugin consumes.
- [cordis configuration primer](../../../docs/cordis-primer.md) — patch-layer composition.
- [Web app bundle](../../bundle/web-app/README.md) — the client's recent-workspace restore behavior.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits describe current package constraints.

- The plugin only acts when the registry is empty; a registry whose workspaces were all deleted by hand still counts as populated and is left alone.
- The created workspace is host state only; nothing resumes an unsent draft or onboards the operator beyond unlocking the composer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package is the in-repo replacement for a machine-local third-party plugin that this fork must not reference (AGENTS.md, plugin-isolation rule). The default-home path must keep flowing through `@deepseek-ai/dsh-home-paths`; a hand-rolled `homedir()` fallback would leak runtime state into an upstream dsh installation.

</details>
