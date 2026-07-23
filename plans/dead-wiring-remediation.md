# Dead Wiring Remediation Plan

**Date:** 2026-07-22
**Status:** Draft
**Priority:** P0 (silent failures with no error signal)

## Overview

Several features are wired into the codebase but never actually execute due to missing callers, dropped parameters, or unguarded error paths. This plan catalogs every gap and prescribes the exact fix.

---

## Issue 1 — `config` Dropped on Every `indexDocument` Call

### Symptom

`scheduleAiFeatures()` (auto-tagging, SEO meta) is gated on `config` being passed to `indexDocument()`. Every call site omits it.

### Call sites

| File | Line | Current | Fix |
|---|---|---|---|
| `src/indexer/index.ts` (reindexAll) | ~129 | `indexDocument(slug, content)` | `indexDocument(slug, content, config)` |
| `src/indexer/index.ts` (watchStorage) | ~183 | `indexDocument(slug, content)` | `indexDocument(slug, content, config)` |
| `src/micropub/index.ts` | ~83 | `indexDocument(slug, content)` | `indexDocument(slug, content, config)` |
| `src/jobs/processors/indexing.ts` | ~9 | `indexDocument(slug, rawMdx)` | `indexDocument(slug, rawMdx, config)` (+ need to pass config through the job payload) |

### Fix

Pass `config` at all four call sites. For the `processIndexing` job path, the `config` object must be serialized into the job payload since Piscina workers run in a separate thread — they cannot import config from the main process.

**Effort:** 30 minutes

---

## Issue 2 — Orphaned `enqueue*` Functions

### Symptom

Four `enqueue*` functions in `src/jobs/schedule.ts` have zero callers outside their own module. The entire async indexing chain is unreachable.

### Orphaned exports

| Function | Callers outside `src/jobs/` | Notes |
|---|---|---|
| `enqueuePdfGeneration` | 0 | Sync PDF route works; background processor is duplicate dead code |
| `enqueueEpubGeneration` | 0 | Sync EPUB route works; background processor is duplicate dead code |
| `enqueueIndexing` | 0 | **Root cause**: nothing calls this, so `processIndexing` never fires, so AI embeddings and IPFS auto-pin never fire |
| `enqueueIpfsPinning` | 0 | Manual POST /pin works; auto-pin on index never fires |

### Fix

Choose one of:

**Option A (simpler):** Remove `processIndexing` entirely. Add AI embedding and IPFS pin scheduling directly into `indexDocument` alongside the existing `scheduleAiFeatures` call, gated the same way (`config.ai?.enabled`, `config.ipfs?.enabled`).

**Option B (queue-driven):** Replace the direct `indexDocument` calls in `reindexAll` and `watchStorage` with `enqueueIndexing`, so all indexing flows through the worker. Requires: (1) adding `config` to the job payload in `schedule.ts`, (2) deserializing it in `processIndexing`.

Either option requires Fix 1 (passing config) first.

**Effort:** 1-2 hours (either option)

---

## Issue 3 — Unguarded `parseToIR` in Renderers

### Symptom

`parseToIR` throws on malformed MDX. The indexer wraps it in try-catch. The RSS renderer and HTTP server do not.

### Call sites

| File | Line | Risk |
|---|---|---|
| `src/renderers/rss.ts` | ~87 | One bad doc → RSS feed 500s for all subscribers |
| `src/servers/http.ts` | ~522 | Bad doc on cache miss → unhandled 500, error silently swallowed |

### Fix

**RSS renderer:** Wrap `parseToIR` in try-catch. On error, skip that document or emit a minimal `<item>` with title/slug only. Do not let one bad doc break the entire feed.

**HTTP server:** Wrap `parseToIR` in try-catch. On parse failure, log the error and return a proper 500 response.

**Effort:** 15 minutes each

---

## Issue 4 — PDF/EPUB Job Processors Are Dead Code

### Symptom

`src/jobs/processors/pdf-generation.ts` and `epub-generation.ts` are real implementations but nothing ever enqueues them. The sync API routes (`GET /api/v1/docs/*.pdf`, `GET /api/v1/collections/:name.epub`) handle these inline and work correctly.

### Fix

Decision required: **(a)** delete the processor files and rely on the sync routes, or **(b)** add `enqueuePdfGeneration`/`enqueueEpubGeneration` calls at meaningful points (e.g., post-index, on document update).

Recommendation: Delete the processors. The sync routes are proven and the background job infrastructure adds complexity without benefit for these fast operations.

**Effort:** 15 minutes to delete + remove from processor index

---

## Execution Order

```
1. Fix 1 — Pass config through indexDocument (prerequisite for Fix 2)
2. Fix 2 — Wire enqueueIndexing OR inline AI/IPFS into indexDocument
3. Fix 3a — Guard parseToIR in RSS renderer
4. Fix 3b — Guard parseToIR in HTTP server
5. Fix 4 — Delete or connect PDF/EPUB processors
```

Fixes 3 and 4 are independent of 1 and 2 and can be done in parallel.
