#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 22.18 or newer, then start again.' >&2
  exit 1
fi
exec node scripts/start.mjs
