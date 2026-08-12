# ADR — Text Selection Across Blocks in the GTK Renderer

- **Status:** Accepted (Phase 2 spike, task p2-t10)
- **Date:** 2026-08-12
- **Decision owner:** Daniel / Selfagency
- **Related:** `0001-ui-framework-choice.md`, `0005-tdd-discipline.md`
- **Open question resolved:** Q2 (phase doc `02-smolnet-protocols.md` §3.11)

## Context

Hypernext renders a protocol-agnostic `Vec<Block>` (heading, paragraph, list,
quote, code, link, image, table, separator, raw) into native GTK4 widgets via
`crates/hypernext-app/src/render/mod.rs` (task p2-t9). The current renderer
builds one `gtk::Label` / `gtk::Box` / `gtk::LinkButton` per block inside a
vertical container.

Problem: GTK's text-selection model is **per-widget**. Dragging across a
paragraph into a following list or code block selects within the first label
only — text cannot be selected across block boundaries. HTML solves this with
a global (document-level) selection; GTK labels have none. This is a core
reader-view expectation: users copy a paragraph plus its list plus a code
sample in one gesture.

Four options were prototyped and evaluated.

## Decision

**Render selectable document text through a single `GtkTextView` backed by one
`GtkTextBuffer` with styled `GtkTextTag`s.** Non-text blocks (images, raw
payloads, separators) are embedded where they fall as child widgets via
`GtkTextChildAnchor`. The `TextView` is set read-only (`set_editable(false)`),
so it is a reader view with native selection + copy and no caret.

This is the recommendation formally evaluated in the spike module
`crates/hypernext-app/src/render/spike_textview.rs`, whose pure transform
(`Block -> tagged text entries`) is unit-tested and whose full buffer pipeline
is verified by an `#[ignore]`d display-gated test.

### How each block maps

| Block | TextBuffer treatment |
|---|---|
| Heading | text + `h1`/`h2`/`h3` tag |
| Paragraph / Quote | runs + `paragraph`/`quote` tag; inline bold/italic/code layered per run |
| List | bullet/number marker + item text, `list-item` tag per item |
| Code | text + `code` tag |
| Link | text + `link` tag; click handling via tag `activate` signal (Phase 3) |
| Table | cells flattened as paragraph-tagged text (spike simplification) |
| Image / Raw(image) | `GtkTextChildAnchor` widget fallback |
| Separator / Raw(other) | `GtkTextChildAnchor` widget fallback |

## Considered alternatives

### Option 2: Per-block `GtkLabel`s with container-level selection (rejected)

GTK4 gives no cross-label selection. A `GtkTextView` and `GtkText` are the only
widgets with a real selection model. Simulating drag spanning many labels
requires a custom widget owning selection state, hit-testing, screen-to-buffer
mapping for every block, and reimplementing caret/IME/AT integration — a
large, bug-prone surface with no platform benefit.

### Option 3: Custom widget with its own selection state (rejected)

Feasible in principle (render each block as a sub-widget, track a drag rect in
widget coordinates). But it reimplements what `GtkTextView` already does
correctly: text layout, word wrap, selection rendering, clipboard integration,
accessibility (AT-SPI / AXUIElement), and keyboard navigation. High effort,
high risk of subtle selection bugs, and the accessibility story would lag
GTK's native one for the foreseeable future.

### Option 4: Accept per-block selection for 1.0 (rejected)

Documents a known UX gap rather than fixing it (phase doc risk R3).
Cross-block copy is a core reader affordance; deferring to a future phase
every time we want it means touching the renderer twice (once now with labels,
once later with a text body). The cost of choosing the text-body path now is
small and the selection model is the correct long-term one, so accepting the
gap is the wrong trade.

### Option 1 (chosen): Single `GtkTextView` + tagged `GtkTextBuffer`

The only option that gives native, cross-block, accessible selection with a
fraction of the code. Its quoted tradeoff — losing per-widget interactivity —
is mitigated:

- Links: `GtkTextView` supports clickable text tags (`TextTag::activate`), so
  links stay interactive with focus/keyboard support. This is strictly more
  a11y-correct than a label+LinkButton mix because links are inline text.
- Images/raw: `GtkTextChildAnchor` lets arbitrary widgets (a `GtkPicture` for
  image bytes) sit inline in the text flow, preserving rich content.
- Layout granularity (e.g. per-block CSS spacing) is recovered via tag
  properties and margins rather than widget spacing — a much smaller loss.

## Consequences

### Positive

- Cross-block selection, copy, and find work for free (single buffer).
- Accessibility: one `GtkTextView` exposes document text to AT-SPI /
  AXUIElement with correct reading/selection semantics, vs. N labels.
- Reachability: reuses `mapping.rs`'s pure conventions — the `Block ->
  tagged-text` transform is display-free and unit-tested (ADR 0005).
- Simpler shell wiring: the scrolled body is one widget, not a box to manage.

### Negative / accepted costs

- Loses per-widget CSS class granularity; styling moves to per-tag style
  providers / CSS on tag names.
- Interactive blocks (images) become anchors, not siblings; more care in the
  widget-embedding path.
- Table rendering is weaker in pure text flow; a hybrid (widget table inside
  an anchor) may be needed for real tables.
- `GtkTextView` renders as document text, not a grid; pixel-exact layouts
  (e.g. two-column) are out of scope for the reader view.

**Non-conformance is a release blocker** only if a future change reintroduces
per-block-only selection with no documented gap decision.

## What Phase 3 shell wiring must do

1. Replace the `render::render_doc` call in the tab body with the
   `spike_textview::render_doc` text-body renderer (promote the spike).
2. Register `GtkTextTag` style providers / CSS classes for each tag name
   (`h1`..`link`) so theming lives in CSS, not code.
3. Wire link tags: connect the `TextTag::activate` signal to the shell's
   navigator (`Dispatcher`), preserving SSRF checks (`FetchPolicy::check_url`).
4. Embed real non-text widgets: image bytes -> `GtkPicture` via
   `GtkTextChildAnchor`; keep the "unsupported content" placeholder for
   non-image raw (invariant #10).
5. A11y: set `accessible_role`/`accessible_label` on the text view; verify with
   the GTK4 inspector.
6. Test: add integration coverage asserting buffer text + tag application for
   representative fixtures of every protocol (ADR 0005).

## Decision review

This ADR should be reviewed:

- After the spike is promoted into the tab body (Phase 3 milestone).
- During 1.1 Feeds if a feed-entry read view needs a different selection
  policy.
- If a future release needs pixel-exact two-column layouts that text flow
  cannot express — revisit hybrid-widget tables then.
