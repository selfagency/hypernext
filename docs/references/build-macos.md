# Building and Bundling Hypernext for macOS

> Status: **PROVEN end-to-end** (R1 spike, 2026-08-12): dev compile, window-open via Homebrew GTK4, AND a self-contained `Hypernext.app` via Homebrew-dylib-bundling (`cargo-bundle` + `dylibbundler`). Produced 46MB bundle; launches with no system GTK. gvsbuild (Option B) kept as documented fallback.

## Two distinct concerns

1. **Dev/runtime deps for compiling** — the Rust `gtk4`/`relm4` crates need `gtk4.pc` (and its transitive `.pc` files) discoverable by `pkg-config`. Without this, `cargo check` fails at `gdk4-sys` build time.
2. **Distribution bundle** — shipping a self-contained `.app` that carries the GTK runtime so end users do not need GTK installed. **PROVEN via Homebrew-dylib-bundling (Option C below) — the primary path.**

The spike proved both.

## Prerequisites

- Rust 1.83+ (MSRV, enforced via CI)
- macOS 14+ (primary target)
- Homebrew (`/opt/homebrew` on Apple Silicon)
- `cargo-bundle` (`cargo install cargo-bundle`)
- `dylibbundler` (`brew install dylibbundler`)
- For Option B (fallback): Python 3.11+ (gvsbuild requirement)

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

```text
The system library `gtk4` required by crate `gdk4-sys` was not found.
The file `gtk4.pc` needs to be installed and the PKG_CONFIG_PATH
environment variable must contain its parent directory.
HINT: you may need to install a package such as gtk4, gtk4-dev or gtk4-devel.
```

Fix: install GTK4 (Homebrew option A, or gvsbuild below), or point `PKG_CONFIG_PATH` at the directory containing `gtk4.pc`.

## Option B — gvsbuild GTK runtime for distribution bundling

> **Fallback path.** Option C (below) is the primary, proven bundling path. Use gvsbuild only if you need a fully relocatable non-Homebrew build (e.g. no Homebrew on the build machine).

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

```text
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

```text
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
- **Fallback only:** the primary bundling path is Option C (Homebrew dylib bundling), proven in the R1 spike. gvsbuild remains the documented recipe for a from-source relocatable build and was NOT re-exercised end-to-end in this spike.
- **Signing/notarization** is out of scope for t0; needed for distribution (ADR 0010 / release gate).

## Option C — Homebrew-dylib-bundling (PROVEN, primary bundling path)

> **Proven end-to-end in the R1 spike (2026-08-12).** Produces a self-contained `Hypernext.app` (~46MB) by bundling the Homebrew GTK dylibs into the `.app` and rewriting install names to `@executable_path`. Verifiable via the `--smoke-probe` flag (opens window, asserts title, exits 0). This is the standard, fast macOS path; gvsbuild remains the fallback (Option B).

Bundle config lives in `crates/hypernext-app/Cargo.toml` under `[package.metadata.bundle]` (name `Hypernext`, identifier `com.selfagency.hypernext`, version `0.1.0`, `minimum_system_version = "14.0"`).

Run the bundling script:

```bash
scripts/bundle-macos.sh
```

The script:

1. `cargo build --release -p hypernext-app` then `cargo bundle --release -p hypernext-app` → `.app` skeleton under `target/release/bundle/osx/Hypernext.app`.
2. `dylibbundler` recursively copies every `/opt/homebrew` dylib the binary links into `Contents/Frameworks/` and rewrites their install names to `@executable_path/../Frameworks` (bundle is relocatable).
3. Copies gdk-pixbuf image loaders into `Resources/lib/gdk-pixbuf-2.0/<ver>/loaders/`, generates `loaders.cache` from the **original** brew loaders (bundled ones crash `gdk-pixbuf-query-loaders`), and substitutes a `@RES@` placeholder the runtime wrapper resolves.
4. Copies share data (icons: hicolor + adwaita; `gtk-4.0`; glib schemas) into `Resources/share/` and compiles schemas with `glib-compile-schemas`.
5. Writes a shell wrapper `Contents/MacOS/hypernext-app` that sets `GTK_DATA_PREFIX`, `XDG_DATA_DIRS`, `XDG_CONFIG_DIRS`, `GIO_EXTRA_MODULES`, and `GDK_PIXBUF_MODULE_FILE` to bundle-relative paths, then execs the real binary (`hypernext-app-bin`).
6. Ad-hoc codesigns the bundle (required to run on Apple Silicon).

Verify (all pass in the spike):

```bash
# No /opt/homebrew load commands remain (self-contained):
otool -L Hypernext.app/Contents/MacOS/hypernext-app-bin   # all @executable_path/../Frameworks
# Launches with bundled GTK and exits 0 (window opened, title asserted):
Hypernext.app/Contents/MacOS/hypernext-app --smoke-probe
echo $?   # 0
```

### Known caveats (t8 / spike)

- **Size:** 46MB in the spike — under the ~100MB R1 gate. Grows if more of the Homebrew prefix is pulled in (e.g. adwaita icon theme variants).
- **Homebrew linkage:** bundles whatever Homebrew is installed; install-name rewriting makes the bundle self-contained, but builds on a clean machine should re-verify sizes/closure.
- **Codesign** is ad-hoc (`-s -`). Distribution requires real signing + notarization (ADR 0010 / release gate).

## References

- gvsbuild: <https://github.com/wingtk/gvsbuild>
- Homebrew gtk4 formula: `brew info gtk4`
- gtk-rs installation guide: <https://gtk-rs.org/gtk4-rs/stable/latest/book/>
