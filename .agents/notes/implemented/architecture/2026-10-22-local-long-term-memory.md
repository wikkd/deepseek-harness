# Agent Note: Local, consent-gated long-term memory

Status: implemented

English | [中文](2026-10-22-local-long-term-memory.zh.md)

## Problem

The assistant forgets durable user preferences and facts between conversations. A consumer assistant should be able to remember an explicit request such as a preferred drink or a recurring constraint, but storing personal notes raises consent, privacy, visibility, and prompt-budget questions that a generic memory plugin does not answer. The existing third-party `dsh-tool-memory` stored Markdown files under a configured root and exposed them without a first-run consent gate, an availability switch, a structured edit surface, or a live way to withdraw the model-visible surface.

## Decision

Long-term memory is local-only, explicit, and consent-gated. A fresh install starts with `consented: false` and `enabled: false`; no entry is stored and no memory tool or prompt section is model-visible until the user agrees and turns memory on. Disabling keeps entries and consent but withdraws the tools and prompt section for the next assembled request. The user can view, add, edit, delete, clear, and toggle entries from the Settings memory page.

The capability is split across four packages. `@deepseek-ai/dsh-memory` owns the entry vocabulary, consent state, `ctx.memory` service, and `memory/settings-changed` event. `@deepseek-ai/dsh-memory-local` opens one versioned storage domain from the shared storage stack, stores entries and consent under `<DSH_HOME>/storages/memory.json`, serializes mutations, and decorates the settings methods for the generated `remote.memory` namespace. `@deepseek-ai/dsh-tool-memory` owns `memory_save`, `memory_search`, `memory_forget`, and the bounded prompt section, disposing and re-registering that surface on each settings change. `@deepseek-ai/dsh-client-ui-settings-memory` owns the browser consent, toggle, and entry-management page.

The prompt section is capped by `maxPromptEntries` (default 40) and `maxPromptChars` (default 4000), and is omitted when memory is off or empty. Its header labels entries as background facts about the user rather than instructions, and tells the model to ask when a note conflicts with the current conversation. Saves are explicit: the model must call `memory_save` after the user asks or clearly states a lasting preference. Exact duplicate text refreshes the existing entry instead of creating a second row.

The local provider replaces the third-party `dsh-tool-memory` in the Web profile. Memory reads and writes make no network request and no model call. The settings page reaches the provider only through the generated Remote namespace, so the browser never reads the JSON file directly.

## Alternatives considered

**Keep the third-party Markdown-file memory.** Rejected because it has no first-run consent gate, availability switch, structured edit/delete/clear surface, or live withdrawal of the model-visible surface. It also conflicts with the repository rule that product features are workspace plugins rather than local third-party integrations.

**Automatic conversation extraction.** Rejected for the first release because it would store facts the user did not explicitly choose, make deletion harder to reason about, and require a second model call with its own failure and privacy surface. Explicit saves make the durable state exactly the user-visible state.

**Embedding or semantic search.** Rejected because it adds a model or vector dependency, an index lifecycle, and a new failure mode for a small personal store. `memory_search` uses case-insensitive literal matching over text and kind, capped at 20 results.

**Always inject every entry through a boot-time prompt section.** Rejected because disabled memory would still be model-visible and every entry would consume prompt budget. Dynamic registration plus the two configured bounds keeps disabling honest and the prompt cost predictable.

**Store under `~/.dsh/memories` or a profile-relative Markdown file.** Rejected by the product data-home isolation rule (`~/.xiaoyuan`, overridable by `DSH_HOME`) and by the desire to reuse the existing versioned storage domain rather than a second ad hoc file format.

## Consequences

Memory is unencrypted local JSON, so the product makes no at-rest encryption claim. Mutations serialize inside one Host process; two application instances sharing the same data home are not coordinated. Exact-text deduplication does not merge paraphrases, and the entry cap refuses a new save rather than evicting an older entry. The tool description discourages secrets, but neither the provider nor the settings page classifies or rejects them.

Enabling, disabling, adding, editing, or deleting an entry changes the prompt section or tool set for the next assembled request, which can invalidate prefix reuse from that point. An unchanged memory surface stays cacheable. The package split also makes the contract, storage, model surface, and settings page independently testable, and it keeps the browser from importing Host storage code.

The memory settings page is the first consumer of the generated `remote.memory` contribution in `@deepseek-ai/dsh-api-remotes`; changing a Remote method or snapshot field requires regenerating that contribution, the tool catalog, and the bilingual package documentation in the same change.
