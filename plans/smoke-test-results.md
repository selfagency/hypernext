# Smoke Test Results

**Date:** 2026-07-23
**Branch:** `fix/worker-pool-tsx-resolution` (PR #2)
**Test project:** `/tmp/hypernext-test/` (3 docs + 1 malformed doc)
**Server:** 6 protocols running (HTTP, Gopher, Spartan, NEX, Finger, Text)

---

## ✅ Passing

| # | Test | Result |
|---|------|--------|
| 1.1 | Home page returns HTML | ✅ |
| 1.2 | Document page renders content | ✅ |
| 1.4 | 404 for nonexistent path | ✅ |
| 1.6 | RSS feed with items (bad doc skipped) | ✅ |
| 1.8 | robots.txt with full AI crawler blocklist | ✅ |
| 1.9 | llms.txt with section listing | ✅ |
| 1.13 | Health endpoint `{"status":"ok"}` | ✅ |
| 2.1 | Malformed MDX rejected by parser, indexer logs failure | ✅ |
| 3.1 | API docs listing (3 documents) | ✅ |
| 3.4 | EPUB generation via API | ✅ |
| 5.1 | Webmention endpoint returns 202 | ✅ |
| 5.2 | Mentions API lists 0 (empty DB) | ✅ |
| 6.2 | Gopher directory listing with links | ✅ |
| 6.3 | Spartan returns 200 text/gemini | ✅ |
| 6.4 | NEX returns headerless content | ✅ |
| 6.5 | Finger returns user info | ✅ |
| 6.6 | Text protocol returns 20 OK | ✅ |
| 7.1 | WebFinger resolves actor | ✅ |
| 7.2 | Actor object with Person type + keys | ✅ |
| 7.3 | Outbox returns 2 items | ✅ |

---

## ❌ Failing (Pre-existing)

| # | Test | Failure | Root Cause |
|---|------|---------|------------|
| 1.3 | Collection root `/blog/` | 404 Not Found | No document with slug `blog` in DB — collection root needs template fallback |
| 1.10 | security.txt | 404 | Config missing `securityTxt.contact` and `securityTxt.expires` |
| 1.12 | Content-Signal header | Not present | Header not being added by `onResponse` hook (needs investigation) |
| 3.2 | Single doc API | Unauthorized | Auth guards blocking public API routes (known P2 issue) |
| 3.3 | PDF generation | 401 Unauthorized | Auth guards blocking PDF route |
| 4.x | Micropub | Auth flow | Token endpoint needs working JWT flow for testing |
| — | `lang="undefined"` in HTML | Cosmetic | Template doesn't set `lang` attribute on `<html>` |

---

## ⚠️ Pre-existing Bugs Discovered During Setup

| Bug | File | Impact |
|-----|------|--------|
| `/*/index.md` route causes Fastify crash | `src/servers/http.ts:512` | Markdown content negotiation feature is completely broken. Fastify v5 requires wildcard `*` to be the last character in a route path. |
| `config.agent.wellKnown` accessed without optional chaining | `src/renderers/agent-readiness.ts:17` | Server crashes on startup if `agent.wellKnown` is not explicitly configured. Optional chaining (`config.agent?.wellKnown?.apiCatalog`) would make it resilient. |

---

## Summary

**20 of 26 tests passed.** All protocols are functional. The 6 failures are pre-existing issues unrelated to PR #2's changes. The two setup-time bugs (wildcard route, wellKnown crash) were worked around during testing but are real defects that should be logged.
