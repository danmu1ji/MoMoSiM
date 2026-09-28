#!/usr/bin/env python3
"""Download and prepare DanmuTalk from its public GitHub source."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

REPOSITORY = os.environ.get("MOMOSIM_GITHUB_REPOSITORY", "danmu1ji/danmutalk")
TARGET = Path(os.environ.get("MOMOSIM_DIR", Path.home() / "DanmuTalk")).expanduser()


def progress(step: int, total: int, label: str) -> None:
    filled = round(24 * step / total)
    bar = "#" * filled + "-" * (24 - filled)
    message = f"[{bar}] {100 * step // total:3d}% {label}"
    if sys.stdout.isatty() and "NO_COLOR" not in os.environ:
        print(f"\033[38;2;253;240;119m{message}\033[0m")
    else:
        print(message)


def show_branding(folder: Path) -> None:
    artwork = "\n".join((folder / name).read_text(encoding="utf-8").rstrip() for name in ("ascii.txt", "bigtext.txt") if (folder / name).is_file())
    if artwork:
        print(f"\033[38;2;253;240;119m{artwork}\033[0m" if sys.stdout.isatty() and "NO_COLOR" not in os.environ else artwork)


def main() -> int:
    marker = TARGET / ".momosim-install"
    if TARGET.exists() and not marker.is_file():
        print(f"Refusing to overwrite existing directory: {TARGET}", file=sys.stderr)
        return 2
    progress(0, 4, f"Preparing installation at {TARGET}")
    try:
        request = urllib.request.Request(
            f"https://codeload.github.com/{REPOSITORY}/tar.gz/refs/heads/main",
            headers={"User-Agent": "DanmuTalk-installer/1.0"},
        )
        progress(1, 4, "Downloading DanmuTalk source")
        with urllib.request.urlopen(request, timeout=120) as response, tempfile.TemporaryDirectory(prefix="momosim-install-") as temporary:
            archive = Path(temporary) / "source.tar.gz"
            total = int(response.headers.get("Content-Length", "0") or 0)
            received = 0
            with archive.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
                    received += len(chunk)
                    if total:
                        progress(1, 4, f"Downloading source ({min(100, received * 100 // total)}%)")
            progress(2, 4, "Extracting source")
            source = Path(temporary) / "source"
            source.mkdir()
            with tarfile.open(archive, "r:gz") as bundle:
                base = source.resolve()
                for item in bundle.getmembers():
                    target = (source / item.name).resolve()
                    if target != base and base not in target.parents:
                        raise RuntimeError("Unsafe path in source archive")
                if any(not (item.isfile() or item.isdir()) for item in bundle.getmembers()):
                    raise RuntimeError("Unexpected link or special file in source archive")
                bundle.extractall(source)
            project = next(source.iterdir())
            show_branding(project)
            TARGET.mkdir(parents=True, exist_ok=True)
            shutil.copytree(
                project,
                TARGET,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns(".git", "node_modules", ".tools", "dist", "__pycache__"),
            )
        marker.write_text(f"repository={REPOSITORY}\n", encoding="utf-8")
        (TARGET / "worlds").mkdir(exist_ok=True)
        progress(3, 4, "Installing app and building for immediate launch")
        subprocess.run([sys.executable, str(TARGET / "run.py"), "--prepare"], cwd=TARGET, check=True)
        progress(4, 4, "Installation complete")
        print(f"Installation complete. Launch with: {sys.executable} {TARGET / 'run.py'}")
        print(f"Add a world package to: {TARGET / 'worlds'}")
        return 0
    except (OSError, RuntimeError, tarfile.TarError, urllib.error.URLError, subprocess.CalledProcessError, StopIteration) as error:
        print(f"Installation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
