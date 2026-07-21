<!-- Context: project-intelligence/business | Priority: high | Version: 1.0 | Updated: 2026-07-16 -->

# Business Domain

**Purpose**: Why Hypernext exists, who it serves, and what value it creates.
**Last Updated**: 2026-07-16

## Quick Reference

**Update When**: Product direction changes | New protocols | Audience shifts
**Audience**: Developers, stakeholders, contributors

## Project Identity

```
Project Name: Hypernext
Tagline: Multi-Protocol MDX Document Server
Problem Statement: Publishing tools lock content into HTTP/HTML and force dependency on large platforms or complex stacks.
Solution: A single Node process that turns MDX files into a unified interface served over HTTP, Gemini, Gopher, Spartan, NEX, Text, Finger, RSS, PDF, and EPUB.
```

## Target Users

| User Segment | Who They Are | What They Need | Pain Points |
|--------------|--------------|----------------|-------------|
| IndieWeb publishers | Bloggers, writers, activists | Own their content, syndicate widely, avoid platform lock-in | Big platforms change rules, export is hard, multi-protocol reach requires multiple tools |
| Minimal-stack operators | Solo devs, small communities | Run a site on a cheap VPS with no external daemons | Modern stacks require Redis, Postgres, CDNs, workers |
| Protocol enthusiasts | Smolnet/Gemini/Gopher users | Serve content natively to alternative protocols | Most CMSes only output HTML |

## Value Proposition

**For Users**:
- Write once in MDX, publish everywhere
- Own content as plain files on disk or S3
- Serve readers on modern web and retro/small protocols
- IndieAuth + Micropub for decentralized auth and authoring

**For Operators**:
- Single Node process, zero external daemons
- SQLite persistence, in-memory caching
- Runs on a $5 VPS
- No build pipeline required for content updates

## Success Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Protocol coverage | Number of supported protocols | 8+ |
| Setup complexity | External services required | 0 |
| Content format | Authoring format | MDX |
| Runtime footprint | Process count | 1 |

## Business Constraints

- **No arbitrary JS execution in MDX** — security over flexibility
- **Single process / no external daemons** — cost and operational simplicity
- **Protocol fidelity** — each protocol served according to its spec
- **Open source** — GPL-3.0-or-later

## Roadmap Context

**Current Focus**: Core protocol servers, parser security, IndieAuth/Micropub
**Next Milestone**: POSSE syndication (Mastodon, Bluesky), ActivityPub federation
**Long-term Vision**: Decentralized publishing hub bridging web and smolnet

## 📂 Codebase References

**Project overview**: `AGENTS.md` — full project guide and constraints
**CLI entry**: `src/bin.ts` — how the server starts
**Config defaults**: `src/config.ts` — zero-config scaffolding
**Protocol servers**: `src/servers/` — TCP/TLS implementations
**Federation**: `src/federation/`, `src/bridge/` — syndication and ActivityPub

## Related Files

- `technical-domain.md` — How this business need is solved technically
