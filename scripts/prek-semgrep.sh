#!/usr/bin/env bash
# prek local hook for semgrep (cross-cutting — Hypernext invariant rules).
# Resilient: if semgrep is not installed locally, warn and pass so local dev
# is not blocked. CI always runs it — see .github/workflows/ci.yml (semgrep job).
set -u

if ! command -v semgrep >/dev/null 2>&1; then
  echo "prek: semgrep not installed; skipping (CI enforces semgrep rules). Install with: pip install semgrep"
  exit 0
fi

# Target only source dirs; exclude tests/fixtures and the user's untracked .codacy dir.
semgrep --config semgrep/rules.yaml \
  --error \
  --exclude '**/*test*' \
  --exclude '**/tests/**' \
  --exclude '**/fixtures/**' \
  --exclude '.codacy/**' \
  crates/
