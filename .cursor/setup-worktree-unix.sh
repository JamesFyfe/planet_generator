#!/usr/bin/env bash
# Prepare an isolated agent checkout. Each worktree gets its own node_modules.
# pnpm's content-addressable store is shared, so later worktrees install quickly.
set -euo pipefail

# Cursor's setup shell may not be a login shell, so nvm is not on PATH yet.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi

copy_if_present() {
  local name="$1"
  if [[ -n "${ROOT_WORKTREE_PATH:-}" && -f "$ROOT_WORKTREE_PATH/$name" ]]; then
    cp "$ROOT_WORKTREE_PATH/$name" "$name"
  fi
}

# Gitignored local config. Nothing here is required today; copy when it appears.
for file in .env .env.local .env.development.local; do
  copy_if_present "$file"
done

if [[ ! -f package.json ]]; then
  echo "No package.json yet; skipping dependency install."
  exit 0
fi

# Call corepack directly so setup does not rewrite the Node install via `corepack enable`.
# `corepack pnpm` follows the packageManager field once Phase 0 pins one.
if command -v corepack >/dev/null 2>&1; then
  pnpm() { corepack pnpm "$@"; }
elif command -v pnpm >/dev/null 2>&1; then
  :
else
  echo "pnpm is required. Install Node.js (it includes corepack) or pnpm, then recreate the worktree." >&2
  exit 1
fi

# Frozen install matches CI once a lockfile is committed. Before that, install
# can generate one (Phase 0 scaffold).
if [[ -f pnpm-lock.yaml ]]; then
  pnpm install --frozen-lockfile
else
  pnpm install
fi

echo "Worktree setup complete."
