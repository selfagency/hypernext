#!/usr/bin/env bash
#
# bundle-macos.sh — build a self-contained Hypernext.app that carries the GTK
# runtime (Homebrew dylibs bundled + install names fixed), so end users do not
# need GTK installed.
#
# R1 spike (2026-08-12): proves the Homebrew-dylib-bundling path in minutes.
# gvsbuild (docs/references/build-macos.md Option B) remains the fallback.
#
# Usage: scripts/bundle-macos.sh
set -euo pipefail

PKG="hypernext-app"
APP="Hypernext.app"
BUNDLE_DIR="target/release/bundle/osx"
APP_DIR="$BUNDLE_DIR/$APP"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
FRAMEWORKS="$CONTENTS/Frameworks"
RESOURCES="$CONTENTS/Resources"

BREW_PREFIX="$(brew --prefix)"

# --- 1. Build release binary + cargo-bundle .app skeleton --------------------
cargo build --release -p "$PKG"
cargo bundle --release -p "$PKG"

if [[ ! -d "$APP_DIR" ]]; then
    echo "ERROR: cargo-bundle did not produce $APP_DIR" >&2
    exit 1
fi

# cargo-bundle names the executable after the crate. Locate the real binary.
BIN_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$CONTENTS/Info.plist" 2>/dev/null || echo "$PKG")"
REAL_BIN="$MACOS/$BIN_NAME"
if [[ ! -f "$REAL_BIN" ]]; then
    echo "ERROR: expected binary $REAL_BIN not found" >&2
    exit 1
fi

# --- 2. Bundle the GTK dylib closure ----------------------------------------
# dylibbundler recursively copies every /opt/homebrew dylib the binary links
# and rewrites their install names to @executable_path/../Frameworks so the
# bundle is relocatable. It runs from MacOS/ so -d ../Frameworks lands under
# Contents/Frameworks.
rm -rf "$FRAMEWORKS"
mkdir -p "$FRAMEWORKS"
(
    cd "$MACOS"
    dylibbundler -x "$BIN_NAME" \
        -b \
        -d ../Frameworks \
        -p '@executable_path/../Frameworks' \
        -s "$BREW_PREFIX/opt/gtk4/lib" \
        -s "$BREW_PREFIX/opt/glib/lib" \
        -s "$BREW_PREFIX/lib" \
        -cd -of -ns
)

# --- 3. gdk-pixbuf image loaders (dlopened, not linked) ---------------------
# Copy loaders, generate the loader registry (loaders.cache) from the bundled
# copies, and rewrite their dep install names into Frameworks too.
GP_PREFIX="$BREW_PREFIX/opt/gdk-pixbuf"
GP_LIBDIR="$(echo "$GP_PREFIX"/lib/gdk-pixbuf-2.0/*)"
GP_DEST="$RESOURCES/lib/gdk-pixbuf-2.0/$(basename "$GP_LIBDIR")"
mkdir -p "$GP_DEST/loaders"
cp "$GP_LIBDIR"/loaders/*.so "$GP_DEST/loaders/"
(
    cd "$GP_DEST/loaders"
    for loader in *.so; do
        dylibbundler -x "$loader" \
            -b \
            -d ../../../../Frameworks \
            -p '@executable_path/../Frameworks' \
            -s "$BREW_PREFIX/opt/glib/lib" \
            -s "$BREW_PREFIX/opt/gdk-pixbuf/lib" \
            -s "$BREW_PREFIX/opt/gettext/lib" \
            -s "$BREW_PREFIX/lib" \
            -cd -of -ns
    done
)
# Generate the loader registry from the ORIGINAL brew loaders (the bundled
# copies have @executable_path deps and crash gdk-pixbuf-query-loaders), then
# rewrite the absolute loader paths in the cache to the bundle so the app
# dlopens the bundled (relocatable) loaders at runtime.
gdk-pixbuf-query-loaders "$GP_LIBDIR"/loaders/*.so > "$GP_DEST/loaders.cache"
sed -i '' "s|$GP_LIBDIR/loaders|@RES@/lib/gdk-pixbuf-2.0/$(basename "$GP_LIBDIR")/loaders|g" "$GP_DEST/loaders.cache"

# --- 4. Share data: icons, glib schemas, gtk-4.0 data -----------------------
SHARE="$RESOURCES/share"
mkdir -p "$SHARE"

# Icon themes (hicolor from gtk4, adwaita for the default theme).
cp -R "$BREW_PREFIX/opt/gtk4/share/icons" "$SHARE/"
cp -R "$BREW_PREFIX/opt/adwaita-icon-theme/share/icons/"* "$SHARE/icons/" 2>/dev/null || true

# GTK4 app data (emoji data etc.).
cp -R "$BREW_PREFIX/opt/gtk4/share/gtk-4.0" "$SHARE/" 2>/dev/null || true

# glib schemas: copy GTK-provided gschema.xml files, then compile.
SCHEMAS="$SHARE/glib-2.0/schemas"
mkdir -p "$SCHEMAS"
cp "$BREW_PREFIX/opt/gtk4/share/glib-2.0/schemas/"*.gschema.xml "$SCHEMAS/" 2>/dev/null || true
glib-compile-schemas "$SCHEMAS"

# --- 5. Runtime env wrapper --------------------------------------------------
# The wrapper computes bundle-relative paths (bundle may live anywhere) and
# sets the GTK runtime env vars before exec'ing the real binary. The real
# binary is renamed <bin>-bin; @executable_path in it still resolves to MacOS/,
# so the Framework dylibs resolve correctly.
cp "$REAL_BIN" "$MACOS/${BIN_NAME}-bin"
WRAPPER="$MACOS/$BIN_NAME"
cat > "$WRAPPER" <<'EOF'
#!/bin/sh
# Hypernext runtime wrapper: point GTK at the bundled resources.
DIR="$(cd "$(dirname "$0")" && pwd)"
RES="$DIR/../Resources"
export GTK_DATA_PREFIX="$RES"
export XDG_DATA_DIRS="$RES/share"
export XDG_CONFIG_DIRS="$RES/share"
export GIO_EXTRA_MODULES="$RES/lib/gio/modules"
# GDK_PIXBUF_MODULE_FILE must point at an absolute loader path; substitute
# the bundle-relative placeholder into a writable temp copy.
CACHE_SRC="$RES/lib/gdk-pixbuf-2.0/__GP_VERSION__/loaders.cache"
CACHE="$TMPDIR/hypernext-loaders.cache"
if [ -f "$CACHE_SRC" ]; then
    sed "s|@RES@|$RES|g" "$CACHE_SRC" > "$CACHE"
    export GDK_PIXBUF_MODULE_FILE="$CACHE"
fi
exec "$DIR/hypernext-app-bin" "$@"
EOF
chmod +x "$WRAPPER"
# Substitute the actual gdk-pixbuf version dir into the wrapper.
sed -i '' "s|__GP_VERSION__|$(basename "$GP_LIBDIR")|g" "$WRAPPER"

# --- 6. Ad-hoc codesign (required to run on Apple Silicon) -------------------
codesign --force --deep -s - "$APP_DIR" 2>/dev/null || \
    echo "WARN: ad-hoc codesign skipped/failed (not fatal for local spike)" >&2

echo
echo "=== Bundle: $APP_DIR ==="
echo "Size: $(du -sh "$APP_DIR" | cut -f1)"
echo
echo "=== Binary deps (must show @executable_path, no /opt/homebrew) ==="
otool -L "$MACOS/${BIN_NAME}-bin" | grep -iE '@executable_path|/opt/homebrew' | sort -u
echo
echo "=== Any leftover /opt/homebrew LOAD COMMANDS in bundled dylibs (must be empty) ==="
LEFTOVER=0
for f in "$FRAMEWORKS"/*.dylib; do
    if otool -L "$f" 2>/dev/null | grep -q '/opt/homebrew'; then
        echo "LEFTOVER: $f"
        LEFTOVER=1
    fi
done
if [ "$LEFTOVER" -eq 0 ]; then
    echo "(none - bundle is relocatable)"
else
    echo "WARN: /opt/homebrew load commands remain - bundle is NOT self-contained" >&2
fi
echo
echo "Bundle written to $APP_DIR"
