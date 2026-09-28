#!/usr/bin/env python3
"""Prepare or launch DanmuTalk across Windows, macOS, and Linux."""
from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT / ".tools"
NODE_BASE = "https://nodejs.org/download/release/latest-v22.x"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "DanmuTalk-bootstrap/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def node_asset() -> tuple[str, str]:
    system, machine = platform.system(), platform.machine().lower()
    arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(machine)
    if not arch:
        raise RuntimeError(f"Unsupported CPU architecture: {machine}")
    if system == "Windows":
        return f"-win-{arch}.zip", "zip"
    if system == "Darwin":
        return f"-darwin-{arch}.tar.gz", "tar"
    if system == "Linux":
        suffix = f"linux-{arch}"
        if arch == "x64":
            ldd = shutil.which("ldd")
            if ldd:
                try:
                    result = subprocess.run([ldd, "--version"], capture_output=True, text=True, timeout=3, check=False)
                    if "musl" in (result.stdout + result.stderr).lower():
                        suffix += "-musl"
                except (OSError, subprocess.SubprocessError):
                    pass
        return f"-{suffix}.tar.xz", "tar"
    raise RuntimeError(f"Unsupported operating system: {system}")


def ensure_node() -> Path:
    local_dir = TOOLS / "node"
    local_node = local_dir / ("node.exe" if os.name == "nt" else "bin/node")
    for candidate in (shutil.which("node"), str(local_node) if local_node.exists() else None):
        if candidate:
            try:
                major = int(subprocess.check_output([candidate, "--version"], text=True).strip().lstrip("v").split(".")[0])
                if major >= 22:
                    return Path(candidate)
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
    print("Downloading verified Node.js 22 runtime...")
    suffix, kind = node_asset()
    sums = fetch(f"{NODE_BASE}/SHASUMS256.txt").decode()
    selected = next((line.split() for line in sums.splitlines() if len(line.split()) >= 2 and re.fullmatch(r"node-v22\.\d+\.\d+" + re.escape(suffix), line.split()[-1].lstrip("*"))), None)
    if not selected:
        raise RuntimeError(f"Could not find a Node.js 22 archive ending in {suffix}")
    expected, name = selected[0], selected[-1].lstrip("*")
    archive = fetch(f"{NODE_BASE}/{name}")
    if hashlib.sha256(archive).hexdigest() != expected:
        raise RuntimeError("Node.js download checksum did not match")
    with tempfile.TemporaryDirectory(prefix="momosim-node-") as temporary:
        archive_path = Path(temporary) / name
        stage = Path(temporary) / "extract"
        archive_path.write_bytes(archive)
        stage.mkdir()
        if kind == "zip":
            with zipfile.ZipFile(archive_path) as bundle:
                bundle.extractall(stage)
        else:
            with tarfile.open(archive_path, "r:*") as bundle:
                base = stage.resolve()
                for item in bundle.getmembers():
                    target = (stage / item.name).resolve()
                    if target != base and base not in target.parents:
                        raise RuntimeError("Unsafe path in Node.js archive")
                for item in bundle.getmembers():
                    if not (item.isfile() or item.isdir() or item.issym() or item.islnk()):
                        raise RuntimeError("Unexpected special file in Node.js archive")
                    link = (stage / item.name).parent / item.linkname if item.issym() else stage / item.linkname
                    if (item.issym() or item.islnk()) and stage.resolve() not in link.resolve().parents:
                        raise RuntimeError("Unsafe link in Node.js archive")
                bundle.extractall(stage)
        extracted = next(stage.iterdir())
        if local_dir.exists():
            shutil.rmtree(local_dir)
        shutil.copytree(extracted, local_dir)
    return local_node


def environment() -> tuple[dict[str, str], str]:
    node = ensure_node()
    node_dir = node.parent
    env = os.environ.copy()
    env["PATH"] = str(node_dir) + os.pathsep + env.get("PATH", "")
    npm = str(node_dir / ("npm.cmd" if os.name == "nt" else "npm"))
    local_pnpm_dir = TOOLS / "pnpm/node_modules/.bin"
    env["PATH"] = str(local_pnpm_dir) + os.pathsep + env["PATH"]
    return env, npm


def run(command: list[str], env: dict[str, str]) -> None:
    print("▶", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, env=env, check=True, shell=os.name == "nt" and command[0].lower().endswith(".cmd"))


def show_branding() -> None:
    lines = []
    for name in ("ascii.txt", "bigtext.txt"):
        path = ROOT / name
        if path.is_file():
            lines.append(path.read_text(encoding="utf-8").rstrip())
    if lines:
        art = "\n".join(lines)
        if sys.stdout.isatty() and "NO_COLOR" not in os.environ:
            print(f"\033[38;2;253;240;119m{art}\033[0m")
        else:
            print(art)


def prepare() -> None:
    env, npm = environment()
    pnpm = shutil.which("pnpm", path=env["PATH"])
    version = ""
    if pnpm:
        try:
            version = subprocess.check_output([pnpm, "--version"], text=True, env=env).strip()
        except (OSError, subprocess.SubprocessError):
            pass
    if not version.startswith("9."):
        print("Installing local pnpm 9...")
        run([npm, "install", "--prefix", str(TOOLS / "pnpm"), "pnpm@9.15.0"], env)
        pnpm = str(TOOLS / "pnpm/node_modules/.bin" / ("pnpm.cmd" if os.name == "nt" else "pnpm"))
    assert pnpm
    run([pnpm, "install", "--frozen-lockfile"], env)
    run([pnpm, "build"], env)
    run([pnpm, "--filter", "@world-player/desktop", "build"], env)


def main() -> int:
    args = sys.argv[1:]
    try:
        show_branding()
        if "--prepare" in args:
            prepare()
            print(f"DanmuTalk is ready. Launch with: {sys.executable} run.py")
            return 0
        env, _ = environment()
        if "--dev" in args:
            pnpm = shutil.which("pnpm", path=env["PATH"]) or str(TOOLS / "pnpm/node_modules/.bin" / ("pnpm.cmd" if os.name == "nt" else "pnpm"))
            run([pnpm, "--filter", "@world-player/desktop", "exec", "vite", "--port", os.environ.get("PORT", "5173")], env)
            return 0
        if not (ROOT / "apps/desktop/dist/index.html").is_file():
            raise RuntimeError("App is not built yet. Run: python run.py --prepare")
        run([str(ensure_node()), "tools/serve.mjs", "--port", os.environ.get("PORT", "5173")], env)
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError, urllib.error.URLError) as error:
        print(f"DanmuTalk setup/launch failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
