#!/usr/bin/env bash
# prek local hook for cargo-audit (Layer 2 — RustSec CVEs).
# Resilient: if cargo-audit is not installed locally, warn and pass so local
# dev is not blocked. CI always runs `cargo audit --deny warnings` (tool is
# installed there) — see .github/workflows/ci.yml (audit job).
set -u

if ! command -v cargo-audit >/dev/null 2>&1; then
  echo "prek: cargo-audit not installed; skipping (CI enforces 'cargo audit --deny warnings'). Install with: cargo install cargo-audit"
  exit 0
fi

cargo audit
