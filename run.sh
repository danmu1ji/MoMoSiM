#!/usr/bin/env bash
# DanmuTalk source launcher for macOS/Linux.
set -euo pipefail
cd "$(dirname "$0")"
if [ -d .tools/node/bin ]; then PATH="$PWD/.tools/node/bin:$PATH"; fi
if [ -d .tools/pnpm/node_modules/.bin ]; then PATH="$PWD/.tools/pnpm/node_modules/.bin:$PATH"; fi
export PATH

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  YELLOW=$'\033[38;2;253;240;119m'; RESET=$'\033[0m'
else
  YELLOW=''; RESET=''
fi
if [[ -f ascii.txt && -f bigtext.txt ]]; then
  printf '%s' "$YELLOW"
  cat ascii.txt bigtext.txt
  printf '%s\n' "$RESET"
else
  printf '%sDanmuTalk%s · local-first character chats\n\n' "$YELLOW" "$RESET"
fi

PORT="${PORT:-5173}"
MODE="${1:-}"

if [ "$MODE" = "--dev" ]; then
  command -v pnpm >/dev/null 2>&1 || { echo "pnpm and project dependencies are required for --dev." >&2; exit 1; }
  [ -d node_modules ] || { echo "Dependencies are missing. Run the installer first." >&2; exit 1; }
  echo "▶ DanmuTalk dev server: http://localhost:${PORT}/"
  exec pnpm --filter @world-player/desktop exec vite --port "$PORT"
fi

if [ ! -f apps/desktop/dist/index.html ]; then
  echo "Built app not found. Run install.sh to prepare DanmuTalk before launching." >&2
  exit 1
fi

echo "▶ Starting DanmuTalk (the server will select a free port if needed)"
exec node tools/serve.mjs --port "$PORT"
