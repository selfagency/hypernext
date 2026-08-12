#!/usr/bin/env bash
# prek local hook for rumdl (markdown formatter).
# Resilient: if rumdl is not installed locally, warn and pass so local dev
# is not blocked. CI always runs it — see .github/workflows/ci.yml (lint job
# installs rumdl via taiki-e/install-action, then runs prek --all-files).
set -u

if ! command -v rumdl >/dev/null 2>&1; then
  echo "prek: rumdl not installed; skipping (CI enforces markdown formatting). Install with: cargo install rumdl"
  exit 0
fi

# Format the staged .md files passed by prek (types = markdown).
rumdl fmt "$@"
