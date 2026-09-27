#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${MOMOSIM_GITHUB_REPOSITORY:-danmu1ji/danmutalk}"
TARGET="${MOMOSIM_DIR:-$HOME/DanmuTalk}"
UPDATE=0
if [[ "${1:-}" == "--update" ]]; then UPDATE=1; fi
MARKER="$TARGET/.momosi-install"

if [[ -e "$TARGET" && ! -f "$MARKER" ]]; then
  echo "Refusing to overwrite an existing folder: $TARGET" >&2
  echo "Set MOMOSIM_DIR to a new folder, or use --update for a DanmuTalk install." >&2
  exit 1
fi
if [[ -f "$MARKER" ]]; then UPDATE=1; fi
if ! command -v curl >/dev/null || ! command -v tar >/dev/null; then
  echo "This installer needs curl and tar (available by default on macOS and most Linux systems)." >&2
  exit 1
fi

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT
mkdir -p "$TARGET"
archive="$tmp/source.tar.gz"
echo "Downloading DanmuTalk source from GitHub..."
curl -fL --retry 2 "https://codeload.github.com/$REPOSITORY/tar.gz/refs/heads/main" -o "$archive"
mkdir "$tmp/source"
tar -xzf "$archive" --strip-components=1 -C "$tmp/source"
cp -a "$tmp/source/." "$TARGET/"
mkdir -p "$TARGET/worlds"
printf 'repository=%s\n' "$REPOSITORY" > "$MARKER"

TOOLS="$TARGET/.tools"
mkdir -p "$TOOLS"
node_ok=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 22 )); then node_ok=1; fi
fi

if (( node_ok == 0 )); then
  system="$(uname -s)"; machine="$(uname -m)"
  case "$system:$machine" in
    Darwin:arm64|Darwin:aarch64) node_platform=darwin-arm64 ;;
    Darwin:x86_64) node_platform=darwin-x64 ;;
    Linux:x86_64|Linux:amd64) node_platform=linux-x64 ;;
    Linux:aarch64|Linux:arm64) node_platform=linux-arm64 ;;
    *) echo "Unsupported CPU/OS for automatic Node.js setup: $system $machine" >&2; exit 1 ;;
  esac
  if [[ "$system" == Linux ]] && command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl && [[ "$node_platform" == linux-x64 ]]; then
    node_platform=linux-x64-musl
  fi
  base="https://nodejs.org/download/release/latest-v22.x"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  node_archive="$(awk -v p="$node_platform" '$2 ~ /^node-v22\./ && $2 ~ ("-" p "\\.tar\\.xz$") {print $2; exit}' "$tmp/SHASUMS256.txt")"
  [[ -n "$node_archive" ]] || { echo "No Node.js 22 archive for $node_platform." >&2; exit 1; }
  curl -fL "$base/$node_archive" -o "$tmp/$node_archive"
  expected="$(awk -v f="$node_archive" '$2 == f {print $1; exit}' "$tmp/SHASUMS256.txt")"
  if command -v sha256sum >/dev/null; then actual="$(sha256sum "$tmp/$node_archive" | awk '{print $1}')"
  else actual="$(shasum -a 256 "$tmp/$node_archive" | awk '{print $1}')"; fi
  [[ "$actual" == "$expected" ]] || { echo "Node.js checksum verification failed." >&2; exit 1; }
  mkdir -p "$TOOLS/node"
  tar -xJf "$tmp/$node_archive" --strip-components=1 -C "$TOOLS/node"
  export PATH="$TOOLS/node/bin:$PATH"
fi

system_pnpm="$(pnpm --version 2>/dev/null || true)"
if [[ ! "$system_pnpm" =~ ^9\. ]]; then
  echo "Installing pnpm locally..."
  npm install --prefix "$TOOLS/pnpm" pnpm@9.15.0
  export PATH="$TOOLS/pnpm/node_modules/.bin:$PATH"
fi

cd "$TARGET"
echo "Installing app dependencies and building DanmuTalk..."
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @world-player/desktop build
echo
if (( UPDATE )); then echo "DanmuTalk updated in $TARGET"; else echo "DanmuTalk installed in $TARGET"; fi
echo "Put your .😭 world package in $TARGET/worlds, then open it in DanmuTalk or drag it onto the app window."
echo "Launch with: $TARGET/run.sh"
