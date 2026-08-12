# Testing GTK4 / Relm4 in CI

> How to run the Hypernext GTK integration tests (`crates/hypernext-app/tests/smoke.rs`)
> in CI and locally. GTK needs a display; the strategy differs per platform.

## Why a display is required

GTK4 initializes a connection to a display server at startup (`gtk::init()`).
Without one, `RelmApp::new()` panics and the smoke test fails. The smoke test
launches the app in-process, asserts the window title via an idle callback, and
quits — it exercises the real GTK main loop, so it cannot run headless.

## macOS (primary target)

Use the system display. The test runs as-is:

```bash
cargo test -p hypernext-app --test smoke
```

No extra setup. If running over SSH without a GUI session, the test will fail
to connect to the display; run it in a logged-in GUI session or use the Linux
`xvfb-run` approach below.

## Linux CI

Run the test under a virtual framebuffer so GTK has a display to connect to:

```bash
# Install xvfb (Debian/Ubuntu)
sudo apt-get install -y xvfb

# Run the smoke test under Xvfb
xvfb-run -a cargo test -p hypernext-app --test smoke
```

`xvfb-run -a` allocates a free display number automatically. For the full
workspace test suite:

```bash
xvfb-run -a cargo test --workspace
```

### GitHub Actions example

```yaml
- name: Install GTK + xvfb
  run: |
    sudo apt-get update
    sudo apt-get install -y libgtk-4-dev xvfb
- name: Test
  run: xvfb-run -a cargo test --workspace
```

## Headless fallback

If a display is genuinely unavailable in a given environment and the smoke test
cannot run, mark it `#[ignore]` with a comment explaining why (per AGENTS.md
§13.3). It is then skipped by default and can be run explicitly with
`cargo test -- --ignored`. The test is currently **not** ignored because the
primary target (macOS 14+) has a system display.

## Related

- `docs/references/build-macos.md` — GTK4 install (Homebrew / gvsbuild) and bundling.
- `docs/references/relm4-debugging.md` — Relm4/GTK4 API gotchas.
