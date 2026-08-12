# Library Lookup Protocol (for AI agents)

> This document is mandatory reading for any AI agent (or human) writing Hypernext code. It defines the protocol for verifying a Rust crate before depending on it.

## Why this exists

The Wails version of Bean accumulated "phantom" dependencies — crate APIs that were assumed from training data but had drifted (or never existed). The `2026-08-06-MASTER-PLAN.md` flagged "Documentation drift — 11+ stale claims, contradictory plans, phantom commits" as a top risk. We will not repeat this in Hypernext.

Every external crate is a contract. We verify the contract before signing.

## The 6-step protocol

Before adding any `use` statement for an external crate, follow these steps in order:

### 1. Verify the crate exists and is healthy

Visit https://crates.io/crates/<name>. Check:

- **Latest version released within the last 12 months.** If >18 months stale, the crate is likely abandoned — search for alternatives.
- **Recent downloads > 100.** A signal of active use. (The smolnet protocol crates we depend on directly are an exception — see `0006-smolnet-protocol-crates.md`.)
- **Repository link works** (not a 404). The repo is where you'll read the CHANGELOG and recent issues.
- **License is compatible.** Allow: `MIT`, `Apache-2.0`, `MPL-2.0`, `BSD-3-Clause`, `ISC`, `Unicode-DFS-2016`. Forbid: `GPL`, `AGPL`, `LGPL` (would force Hypernext to be GPL).
- **MSRV ≤ Hypernext's MSRV.** Hypernext targets Rust 1.83+. If the crate requires 1.90+, it's too bleeding-edge for us.

If the crate is stale, abandoned, or license-incompatible:
- Search for alternatives: https://crates.io/search?q=<topic>
- If no alternative exists, document the risk in `worklog.md` under `## Open questions` and consult with the maintainer before depending on it
- Do NOT silently depend on the abandoned crate

### 2. Read the API documentation

Visit https://docs.rs/<crate>/<version>/<crate>/index.html. Read in this order:

1. **Module-level docs** (the `//!` at the top of `lib.rs`) — gives the mental model
2. **The main entry point** — the type or function you'll use first (usually a `Client`, `Engine`, or top-level function)
3. **The full doc comment** for that entry point, including:
   - Examples (run them mentally; if `cargo test --doc` works, run it)
   - Panics section — what conditions cause a panic
   - Errors section — what error variants it returns
   - Safety section — if unsafe, understand why

### 3. Read the CHANGELOG

Visit the crate's repository (linked from crates.io). Find `CHANGELOG.md` (or `RELEASES.md` or similar). Read:

- The most recent release's notes
- Any "breaking changes" section
- Notes for any version between your pinned version and HEAD — to know what's coming when you upgrade

If the API you plan to use was added in a recent version, verify it exists in the pinned version, not just in HEAD.

### 4. Pin the version

Add to the workspace `Cargo.toml` `[workspace.dependencies]` block:

```toml
<crate> = "1.2"  # caret requirement; allows 1.x.x patches and minors
```

Or for stricter pinning:

```toml
<crate> = "=1.2.3"  # exact version; for crates with sketchy semver history
```

Use `cargo update -p <crate> --precise 1.2.3` to lock the lockfile to a specific version.

Run `cargo tree -p <crate>` to verify no surprise transitive dependencies. If a transitive dep is forbidden (GPL, abandoned), find an alternative.

### 5. If the API doesn't match the phase doc

STOP writing code. The phase doc was written based on research that may now be stale.

1. Open the phase doc in your editor
2. Update the API reference to match the actual API you found
3. Commit the doc change separately with: `docs(<phase>): correct <crate> API`
4. Now proceed with implementation

This is non-negotiable. Silent API drift is what made the Wails version's docs unreliable.

### 6. When in doubt

- Don't guess.
- Use the `web-search` skill (`Skill(command="web-search")`) to search for the API.
- Use the `web-reader` skill (`Skill(command="web-reader")`) to fetch the docs.rs page or the repository README.
- If still unclear, document the question in `worklog.md` under `## Open questions` and propose a path forward. Move on; don't block.

## Examples

### Example 1: Adding `feed-rs` for RSS/Atom parsing

1. **Verify:** Visit https://crates.io/crates/feed-rs
   - Latest: v2.4.0 (2026-07-07) ✓
   - Total downloads: ~2M ✓
   - Recent downloads: ~688K ✓
   - License: MIT ✓
   - MSRV: not specified (assume compatible)
   - Repo: https://github.com/feed-rs/feed-rs ✓

2. **Read docs:** Visit https://docs.rs/feed-rs/2.4.0/feed_rs/
   - Module-level docs explain the parser model
   - Main entry: `feed_rs::parser::parse(Parser)` or `feed_rs::parser::parse_url(...)`
   - Read both; we'll use `parse_url` since we have a URL

3. **Read CHANGELOG:** Visit https://github.com/feed-rs/feed-rs/blob/main/CHANGELOG.md
   - v2.4.0 added improved JSON Feed parsing
   - No breaking changes since v2.0
   - Our pinned v2.4 is the latest

4. **Pin:** Add to workspace `Cargo.toml`:
   ```toml
   feed-rs = "2.4"
   ```

5. **Implement:** In `hypernext-protocol/src/adapters/feed.rs` (Phase 1.1):
   ```rust
   use feed_rs::parser;
   
   pub async fn fetch_feed(url: &Url, client: &reqwest::Client) -> Result<PageDoc, Error> {
       let response = client.get(url.as_str()).send().await?.bytes().await?;
       let feed = parser::parse(&response[..]).map_err(|e| Error::FeedParse(e.to_string()))?;
       // Convert feed.items to Vec<Block>
       ...
   }
   ```

6. **Document:** Add the `feed-rs` API entry to the Phase 1.1 doc's "References" section.

### Example 2: Encountering an unexpected API

You're implementing SSH and read in the Phase 3.0 doc that `russh` v0.62 has a `Session::connect(url, config)` method. You visit https://docs.rs/russh/0.62.6/russh/ and find the API is actually `Session::connect(config, host, port)` — the arguments are different.

1. STOP writing SSH code.
2. Open `docs/phases/3.0-workshop.md` (to be written).
3. Find the `russh` reference. Update it to match the actual API.
4. Commit: `docs(3.0-workshop): correct russh Session::connect signature`
5. Now proceed with the SSH implementation.

## Forbidden patterns

- ❌ Adding a `use` statement without having read the crate's docs.rs page for the pinned version
- ❌ Copying an API shape from training data without verifying
- ❌ Depending on a crate without checking its license
- ❌ Silently working around an API mismatch without updating the phase doc
- ❌ Bumping a crate version without reading the CHANGELOG

## Crate health audit (snapshot 2026-08-11)

The full audit results are in `crate-audit.md`. Highlights:

- **Healthy (use directly):** rusqlite, sqlx, refinery, sqlite-vec, tantivy, reqwest, ureq, hyper, hickory-resolver, arti, webrtc, keyring, pgp, sequoia-openpgp, async-imap, lettre, mail-parser, matrix-sdk, russh, alacritty_terminal, adblock, harper-core, feed-rs, scraper, html5ever, lol_html, microformats, pulldown-cmark, comrak, html-to-markdown-rs, legible, atrium-api, atrium-xrpc, atrium-xrpc-client, bsky-sdk, nostr, ipfs (rust-ipfs), iroh, librqbit, fantoccini, thirtyfour, tokio, anyhow, thiserror, tracing, serde, serde_json, chrono, uuid, bytes, nu-ansi-term

- **Stale (avoid or fork-vendor):** mastodon (2016!), kuchiki (2020), syndication (2019), tower-lsp (Aug 2023), lsp-types (Jun 2024), smtp-message (2022), stund (2019), lyrebird (not Tor-related — it's a Bevy audio crate, name collision), shucker, otrr, instant-distance, smol (deprecated)

- **Missing:** rpgp (the actual crate is `pgp`), vt10x (the actual crate is `vte` or `alacritty_terminal`)

- **Direct dependencies (per `0006-smolnet-protocol-crates.md`):** gemini-protocol, scroll-protocol, text-protocol, spartan-protocol, nex-protocol, gopher-protocol, scorpion-protocol, kepler-protocol, guppy-protocol, titanite

- **XMPP (verified mid-plan):** The `xmpp` crate (v0.7.0, 2026-06-11, MPL-2.0) at https://xmpp.rs/ is the production-grade XMPP library — it was missed in the initial audit which only checked the abandoned `xmpp-core`/`xmpp-im` crates from 2017. Use `xmpp` v0.7.0 for the 2.0 Conversation release.

## References

- crates.io: https://crates.io/
- docs.rs: https://docs.rs/
- The Rust API Guidelines: https://rust-lang.github.io/api-guidelines/
- Hypernext crate audit: `crate-audit.md` (in this folder)
