---
kind: upgrade-guide
description: The default harness data home moves from `~/.dsh` to `~/.xiaoyuan`, isolating this product from a separately installed upstream dsh.
---
# Default data home moves from `~/.dsh` to `~/.xiaoyuan`

English | [中文](guide.zh.md)

## Change

The harness resolved its single data root as `$DSH_HOME`, else `~/.dsh`. The default is now `$DSH_HOME`, else `~/.xiaoyuan`. Profiles, session logs, attachments, credentials, caches, speech-to-text models, and the user-global `AGENTS.md` all resolve under the new root. Everyone running without `DSH_HOME` set is affected: the harness no longer sees data stored under `~/.dsh`, and a separately installed upstream dsh — which keeps `~/.dsh` — no longer receives this product's plugins, configuration, or data. Explicit `DSH_HOME` values and configured `dshHome` options behave exactly as before.

## Migration

1. Move the profiles you want to keep: `mv ~/.dsh/profiles ~/.xiaoyuan/profiles` (or copy only the profiles you use).
2. Move optional local state you want to keep, each a directory or file under the home: `sessions/`, `attachments/`, `storages/`, `speech-to-text/`, `cache/`, `.env`, and `.credentials.yaml`.
3. Leave `~/.dsh` untouched if a separately installed upstream dsh still uses it.
4. Start any harness command without `DSH_HOME`; confirm that `~/.xiaoyuan` appears and receives new session logs under `sessions/`, and that `~/.dsh` stays unchanged.
