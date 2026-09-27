#!/usr/bin/env python3
"""Cross-platform DanmuTalk source installer and GitHub release updater."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPOSITORY = "danmu1ji/danmutalk"
SKIP_ALWAYS = {
    ".git", ".agents", ".pi", ".superdesign", "node_modules", "dist", "target",
    "experiments", "artifacts", "research", ".venv", "venv", "__pycache__",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", ".pnpm-store",
}
PERSONAL_FILES = {"progress.md", "limit.txt", "ref.mp3", "momo.jpg", "credentials.json"}
PRIVATE_ASSET_PATHS = {
    "worlds/blue-archive", "worlds/blue-archive.😭", "worlds/.parts",
    "tools/blue-archive", "apps/desktop/public/blue-archive-lite.worldpkg",
}


class Console:
    def __init__(self) -> None:
        self.color = sys.stdout.isatty() and "NO_COLOR" not in os.environ

    def paint(self, text: str, code: str) -> str:
        return f"\033[{code}m{text}\033[0m" if self.color else text

    def say(self, text: str = "") -> None:
        print(text)

    def ask(self, prompt: str, default: str = "") -> str:
        suffix = f" [{default}]" if default else ""
        answer = input(f"{prompt}{suffix}: ").strip()
        return answer or default

    def confirm(self, prompt: str, default: bool = False) -> bool:
        hint = "Y/n" if default else "y/N"
        value = input(f"{prompt} ({hint}): ").strip().lower()
        return (value in {"y", "yes"}) if value else default

    def select(self, label: str, options: list[str], defaults: set[int]) -> set[int]:
        selected = set(defaults)
        while True:
            self.say(self.paint(label, "1;38;2;253;240;119"))
            for i, option in enumerate(options, 1):
                mark = "x" if i in selected else " "
                self.say(f"  [{mark}] {i}. {option}")
            self.say("Enter numbers separated by spaces to toggle; press Enter when done.")
            raw = input("> ").strip()
            if not raw:
                return selected
            if raw.lower() in {"q", "quit"}:
                raise KeyboardInterrupt
            for item in raw.split():
                if item.isdigit() and 1 <= int(item) <= len(options):
                    idx = int(item)
                    selected.symmetric_difference_update({idx})


def get_token() -> str | None:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        return token.strip()
    if shutil.which("gh"):
        result = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=False)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    return None


def request(url: str, token: str | None = None, accept: str = "application/vnd.github+json") -> bytes:
    headers = {
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DanmuTalk-installer",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read()


def latest_release(repository: str, token: str | None = None) -> dict:
    url = f"https://api.github.com/repos/{repository}/releases/latest"
    return json.loads(request(url, token).decode("utf-8"))


def platform_key() -> str:
    system = platform.system().lower()
    if system == "windows":
        return "windows"
    if system == "darwin":
        return "macos"
    if system == "linux":
        return "linux"
    raise RuntimeError(f"Unsupported operating system: {system}")


def release_asset(release: dict, os_key: str) -> tuple[dict, dict]:
    assets = release.get("assets", [])
    archives = [a for a in assets if a["name"].lower().endswith(".zip")]
    chosen = next((a for a in archives if os_key in a["name"].lower()), None)
    chosen = chosen or next((a for a in archives if "universal" in a["name"].lower()), None)
    sums = next((a for a in assets if a["name"].lower() in {"sha256sums", "sha256sums.txt", "checksums.txt"}), None)
    if not chosen or not sums:
        raise RuntimeError("This GitHub release needs a platform .zip and SHA256SUMS.txt asset.")
    return chosen, sums


def safe_extract(archive: Path, destination: Path) -> None:
    base = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for item in bundle.infolist():
            target = (destination / item.filename).resolve()
            if target != base and base not in target.parents:
                raise RuntimeError(f"Unsafe archive path rejected: {item.filename}")
        bundle.extractall(destination)


def download_update(console: Console, target: Path, repository: str) -> None:
    token = get_token()
    release = latest_release(repository, token)
    package, checksums = release_asset(release, platform_key())
    digest_text = request(checksums["url"], token, "application/octet-stream").decode("utf-8", "replace")
    expected = None
    for line in digest_text.splitlines():
        match = re.match(r"^([a-fA-F0-9]{64})\s+\*?(.+)$", line.strip())
        if match and match.group(2).strip() == package["name"]:
            expected = match.group(1).lower()
            break
    if not expected:
        raise RuntimeError(f"No SHA-256 entry found for {package['name']}.")

    with tempfile.TemporaryDirectory(prefix="momosim-update-") as tmp:
        archive = Path(tmp) / package["name"]
        archive.write_bytes(request(package["url"], token, "application/octet-stream"))
        actual = hashlib.sha256(archive.read_bytes()).hexdigest()
        if actual != expected:
            raise RuntimeError("Downloaded release failed SHA-256 verification.")
        target.mkdir(parents=True, exist_ok=False)
        safe_extract(archive, target)
    console.say(console.paint(f"Installed {release.get('tag_name', 'latest')} to {target}", "1;32"))


def should_skip(directory: str, names: list[str], include_tts: bool, include_example: bool) -> set[str]:
    path = Path(directory)
    rel = path.relative_to(ROOT).as_posix() if path != ROOT else ""
    rejected = set()
    for name in names:
        child = (path / name)
        child_rel = f"{rel}/{name}".strip("/")
        if name in SKIP_ALWAYS or name in PERSONAL_FILES or name.startswith(".env"):
            rejected.add(name)
        elif child_rel in PRIVATE_ASSET_PATHS or child_rel.startswith("worlds/blue-archive/"):
            rejected.add(name)
        elif not include_tts and child_rel in {"tools/voice-tts-server.py", "tools/tts-worker.mjs"}:
            rejected.add(name)
        elif not include_example and child_rel == "worlds/examples":
            rejected.add(name)
    return rejected


def copy_source(console: Console, target: Path, include_tts: bool, selections: set[int]) -> None:
    if target.exists():
        raise RuntimeError(f"Install folder already exists: {target}")
    shutil.copytree(ROOT, target, ignore=lambda directory, names: should_skip(directory, names, include_tts, 1 in selections))
    if selections.intersection({3, 4, 5}):
        package = ROOT / "worlds/blue-archive.😭"
        art = ROOT / "worlds/blue-archive/assets/images"
        voices = ROOT / "worlds/blue-archive/tts-references"
        if 3 in selections and package.is_file():
            shutil.copy2(package, target / package.relative_to(ROOT))
        if 4 in selections and art.is_dir():
            dest = target / art.relative_to(ROOT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(art, dest, dirs_exist_ok=True)
        if 5 in selections and voices.is_dir():
            dest = target / voices.relative_to(ROOT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(voices, dest, dirs_exist_ok=True)
    console.say(console.paint(f"Source installed to {target}", "1;32"))
    console.say("Start it with run.sh (macOS/Linux) or run.ps1 (Windows).")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true", help="download the latest GitHub release")
    parser.add_argument("--source", action="store_true", help="install from this source checkout")
    parser.add_argument("--target", type=Path, help="new install directory (must not already exist)")
    parser.add_argument("--repository", default=os.environ.get("MOMOSIM_GITHUB_REPOSITORY", DEFAULT_REPOSITORY))
    args = parser.parse_args()
    console = Console()
    try:
        art = "\n".join((ROOT / name).read_text(encoding="utf-8").rstrip() for name in ("ascii.txt", "bigtext.txt") if (ROOT / name).is_file())
        if art:
            console.say(console.paint(art, "38;2;253;240;119"))
        else:
            console.say(console.paint("DanmuTalk installer", "38;2;253;240;119"))
        console.say(f"Detected platform: {platform.system()} / {platform.machine()}")
        mode = "update" if args.update else "source" if args.source else ""
        if not mode:
            console.say("  1. Install from this source checkout")
            console.say("  2. Download the latest GitHub release")
            mode = "update" if console.ask("Choose", "1") == "2" else "source"
        target = args.target
        if mode == "update":
            if target is None:
                repo_name = args.repository.split("/")[-1]
                target = Path.home() / f"{repo_name}-{platform_key()}-update"
            console.say(f"Repository: {args.repository} (public releases need no GitHub login)")
            download_update(console, target.expanduser(), args.repository)
            return 0

        choices = [
            "Include example world",
            "Include local VoxCPM TTS runtime files (model downloads on first use)",
            "Include Blue Archive world package (copyrighted content; requires distribution rights)",
            "Include Blue Archive character images (requires distribution rights)",
            "Include Blue Archive voice references (derived game audio; requires distribution rights)",
        ]
        selected = console.select("Choose optional components:", choices, {1})
        if selected.intersection({3, 4, 5}) and not console.confirm("I have the rights needed to redistribute the selected Blue Archive-derived assets"):
            selected.difference_update({3, 4, 5})
        if target is None:
            default_dir = Path.home() / "DanmuTalk-source"
            target = Path(console.ask("Install directory", str(default_dir)))
        copy_source(console, target.expanduser(), 2 in selected, selected)
        return 0
    except (KeyboardInterrupt, EOFError):
        console.say("Cancelled.")
        return 130
    except (OSError, RuntimeError, urllib.error.URLError, zipfile.BadZipFile) as error:
        console.say(console.paint(f"Installer failed: {error}", "1;31"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
