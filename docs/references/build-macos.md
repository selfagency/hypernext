# Building and Bundling Hypernext for macOS

> Status: **PROVEN for development compile + window-open via Homebrew GTK4** (spike t0, 2026-08-12).
> Status: **gvsbuild bundling path DOCUMENTED but not yet exercised end-to-end** — the full gvsbuild GTK-from-source build was not run in the t0 spike (hours-long). The exact setup is below; it is the bundling path the app shell (t8) will use.

## Two distinct concerns

1. **Dev/runtime deps for compiling** — the Rust `gtk4`/`relm4` crates need `gtk4.pc` (and its transitive `.pc` files) discoverable by `pkg-config`. Without this, `cargo check` fails at `gdk4-sys` build time.
2. **Distribution bundle** — shipping a self-contained `.app` that carries the GTK runtime so end users do not need GTK installed. This is what gvsbuild provides.

The spike proved (1) and wrote the recipe for (2).

## Prerequisites

- Rust 1.83+ (MSRV, enforced via CI)
- macOS 14+ (primary target)
- Homebrew (`/opt/homebrew` on Apple Silicon)
- For bundling: Python 3.11+ (gvsbuild requirement)

## Option A — Homebrew GTK4 (development / fastest path)

This is what the t0 spike used to verify the Relm4 window opens.

```bash
brew install gtk4
```

This provides `gtk4.pc` (v4.x) plus transitive deps. Homebrew puts `*.pc` under `$(brew --prefix)/lib/pkgconfig`, which the gtk-rs `*-sys` build scripts find automatically.

Then build / run:

```bash
cargo build -p hypernext-app
cargo run -p hypernext-app
```

Verification:

- `cargo check -p hypernext-app` completes (no pkg-config failure)
- `cargo run -p hypernext-app` opens a 1024x768 "Hypernext" `ApplicationWindow` on a display
- Closing the window exits the process cleanly (exit 0)

Headless note: on a machine with no display the window cannot open. Verify with a display (macOS system display; on Linux CI use `xvfb-run`).

### Exact blocker when GTK is absent (for reference)

With no GTK installed, `cargo check` fails in the `gdk4-sys` build script:

```
The system library `gtk4` required by crate `gdk4-sys` was not found.
The file `gtk4.pc` needs to be installed and the PKG_CONFIG_PATH
environment variable must contain its parent directory.
HINT: you may need to install a package such as gtk4, gtk4-dev or gtk4-devel.
```

Fix: install GTK4 (Homebrew option A, or gvsbuild below), or point `PKG_CONFIG_PATH` at the directory containing `gtk4.pc`.

## Option B — gvsbuild GTK runtime for distribution bundling

[gvsbuild](https://github.com/wingtk/gvsbuild) builds GTK and its dependency stack from source into a portable prefix that can be bundled into a `.app`. It is the macOS analog of what Windows apps use to avoid a system GTK dependency.

### Why gvsbuild

- Homebrew GTK is a dev convenience, not a distribution story — it links against Homebrew's non-relocatable prefix.
- gvsbuild produces a **relocatable GTK prefix** whose `bin`, `lib`, and `share` (themes, schemas) can be copied into `MyApp.app/Contents/Resources/`.
- Required for a self-contained app; end users should not need Homebrew or a system GTK install.

### Setup

```bash
# Python 3.11+ required
brew install python
python3 -m venv ~/gvsbuild-venv
source ~/gvsbuild-venv/bin/activate
pip install gvsbuild
```

Build the GTK4 stack (this is the long step — hours; use `--jobs` to parallelize):

```bash
gvsbuild build --jobs=8 gtk4
```

Output prefix defaults to `~/gtk/` (Windows: `C:\gtk-build`). The gvsbuild prefix layout is:

```
~/gtk/bin
~/gtk/lib
~/gtk/share  # includes icons + glib-2.0/schemas
```

### Compiling against the gvsbuild prefix

Point pkg-config at the gvsbuild prefix so the gtk-rs `*-sys` crates find it:

```bash
export PKG_CONFIG_PATH="$HOME/gtk/lib/pkgconfig"
```

Then the normal build works:

```bash
cargo build --release -p hypernext-app
```

### Bundling into the .app

1. Build the release binary (above).
2. Assemble `Hypernext.app`:

```
Hypernext.app/
  Contents/
    Info.plist
    MacOS/
      hypernext-app          # the compiled binary
    Resources/
      bin/                   # from ~/gtk/bin (GTK loader modules, etc.)
      lib/                   # from ~/gtk/lib (dylibs GTK needs)
      share/                 # from ~/gtk/share (icons, glib schemas)
```

3. Runtime search paths so the binary finds the bundled GTK:
   - Set `GTK_DATA_PREFIX` to `../Resources` (relative to `MacOS/`).
   - Set `XDG_DATA_DIRS` and `XDG_CONFIG_DIRS` under `../Resources/share`.
   - Set `GIO_EXTRA_MODULES` to `../Resources/lib/gio/modules`.
   - Ensure `glib-2.0/schemas` is under `Resources/share` and compiled with `glib-compile-schemas`.

4. `Info.plist` must declare `NSHighResolutionCapable` and the app category. `CFBundleIdentifier` = `com.selfagency.hypernext`.

### Known caveats / open items (t8)

- **Binary size risk (R1):** the GTK stack is large. Spike did not measure a final bundle. If the shipped `.app` exceeds ~100MB, the phase plan says: switch to GTK3 or evaluate Iced (see `docs/phases/01-foundation-and-architecture.md` risk R1).
- **Not yet exercised:** the t0 spike ran Option A, not Option B. The gvsbuild build + bundle steps above are the documented recipe and must be validated in t8 before first release.
- **Signing/notarization** is out of scope for t0; needed for distribution (ADR 0010 / release gate).

## References

- gvsbuild: https://github.com/wingtk/gvsbuild
- Homebrew gtk4 formula: `brew info gtk4`
- gtk-rs installation guide: https://gtk-rs.org/gtk4-rs/stable/latest/book/
