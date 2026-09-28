#!/usr/bin/env python3
"""Set up a local llama.cpp model launcher for DanmuTalk.

This tool only writes a small Python launcher and model metadata to
``local-models/``. Model weights are downloaded by that launcher on its first
run, never while this setup wizard is running.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
LOCAL_MODELS = ROOT / "local-models"
HF_API = "https://huggingface.co/api/models"
USER_AGENT = "DanmuTalk-local-model-setup/1.0"
LLAMA_SOURCE_URL = "https://codeload.github.com/ggml-org/llama.cpp/tar.gz/refs/heads/master"


@dataclass(frozen=True)
class ModelOption:
    slug: str
    name: str
    tier_gb: int
    language: str
    repo: str
    license_name: str
    license_url: str
    note: str


MODEL_CATALOG = (
    ModelOption(
        "qwen3-4b-rpg-roleplay-v2-en",
        "Qwen3-4B-RPG-Roleplay-V2",
        4,
        "en",
        "Chun121/Qwen3-4B-RPG-Roleplay-V2",
        "MIT (model card)",
        "https://huggingface.co/Chun121/Qwen3-4B-RPG-Roleplay-V2",
        "English-first roleplay fine-tune; Korean quality is not established.",
    ),
    ModelOption(
        "qwen3-4b-rpg-roleplay-v2-ko",
        "Qwen3-4B-RPG-Roleplay-V2 (Korean, experimental)",
        4,
        "ko",
        "Chun121/Qwen3-4B-RPG-Roleplay-V2",
        "MIT (model card)",
        "https://huggingface.co/Chun121/Qwen3-4B-RPG-Roleplay-V2",
        "No verified Korean-specific 4B RP model was found; Korean quality is unverified.",
    ),
    ModelOption(
        "nyx-rp-9b-en",
        "Nyx-RP-9B-Instruct-2608-v1",
        9,
        "en",
        "Indexnusrefather/Nyx-RP-9B-Instruct-2608-v1",
        "Apache-2.0 (model card)",
        "https://huggingface.co/Indexnusrefather/Nyx-RP-9B-Instruct-2608-v1",
        "English roleplay fine-tune.",
    ),
    ModelOption(
        "qwen35-korean-rp-9b",
        "Qwen3.5-9B Korean Character RP LoRA v2",
        9,
        "ko",
        "www622846/qwen3.5-9b-rp-lora-v2",
        "Apache-2.0 (model card; verify upstream terms)",
        "https://huggingface.co/www622846/qwen3.5-9b-rp-lora-v2",
        "Korean-focused. Its card says the fine-tuning dataset is private.",
    ),
    ModelOption(
        "erebus-rp-12b-en",
        "Erebus-RP-12B-Instruct-2608-v1",
        12,
        "en",
        "mradermacher/Erebus-RP-12B-Instruct-2608-v1-GGUF",
        "Gemma terms (model card)",
        "https://huggingface.co/Indexnusrefather/Erebus-RP-12B-Instruct-2608-v1",
        "English roleplay fine-tune; subject to Gemma terms, not a permissive open-source license.",
    ),
    ModelOption(
        "gemma4-12b-abliterated-ko",
        "Gemma 4 12B Abliterated",
        12,
        "ko",
        "DuoNeural/OpenYourMind-Gemma4-12B-IT-Abliterated-GGUF",
        "Gemma terms (model card)",
        "https://huggingface.co/DuoNeural/OpenYourMind-Gemma4-12B-IT-Abliterated-GGUF",
        "General-purpose model, not Korean-RP fine-tuned; check Google Gemma terms.",
    ),
    ModelOption(
        "himeros-v2-27b-en",
        "Himeros V2 27B",
        27,
        "en",
        "Skttttt/Himeros-V2-27B-GGUF",
        "No separate license grant stated; upstream terms apply",
        "https://huggingface.co/Skttttt/Himeros-V2-27B-GGUF",
        "English roleplay fine-tune. Review base-model terms before use or redistribution.",
    ),
    ModelOption(
        "qwen38-27b-ko",
        "Qwen3.8-27B",
        27,
        "ko",
        "ggml-org/Qwen3.8-27B-GGUF",
        "Apache-2.0 (model card)",
        "https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF",
        "Official GGUF of the general-purpose Qwen model; not an RP fine-tune.",
    ),
)


@dataclass
class Hardware:
    system: str
    machine: str
    cpu_name: str | None = None
    ram_bytes: int | None = None
    gpu_name: str | None = None
    dedicated_vram_bytes: int | None = None
    apple_unified_memory_bytes: int | None = None
    notes: list[str] | None = None

    @property
    def dedicated_vram_gb(self) -> float | None:
        if self.dedicated_vram_bytes is None:
            return None
        return self.dedicated_vram_bytes / (1024**3)


def _run(command: list[str], timeout: float = 8) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None


def _read_linux_ram() -> int | None:
    try:
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def _read_linux_cpu() -> str | None:
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="replace").splitlines():
            if line.lower().startswith(("model name", "hardware")) and ":" in line:
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return None


def _read_hardware_bytes(value: Any, key: str = "") -> int | None:
    """Read VRAM values from common rocm-smi/WMI JSON shapes."""
    if isinstance(value, dict):
        for child_key, child in value.items():
            child_key_text = str(child_key).lower()
            if "total" in child_key_text and ("vram" in child_key_text or "memory" in child_key_text):
                parsed = _read_hardware_bytes(child, child_key_text)
                if parsed:
                    return parsed
            parsed = _read_hardware_bytes(child, child_key_text)
            if parsed:
                return parsed
        return None
    if isinstance(value, list):
        values = [_read_hardware_bytes(item, key) for item in value]
        values = [item for item in values if item]
        return max(values) if values else None
    if isinstance(value, (int, float)):
        numeric = int(value)
    elif isinstance(value, str):
        match = re.search(r"([\d,]+(?:\.\d+)?)\s*(bytes?|b|kib|mib|gib|kb|mb|gb)?", value, re.I)
        if not match:
            return None
        numeric = int(float(match.group(1).replace(",", "")))
        unit = (match.group(2) or "").lower()
        if unit.startswith("g"):
            numeric *= 1024**3
        elif unit.startswith("m"):
            numeric *= 1024**2
        elif unit.startswith("k"):
            numeric *= 1024
    else:
        return None
    if numeric <= 0:
        return None
    # roc* tools and WMI may report raw bytes or an explicit size in MiB/GB.
    if numeric < 128 * 1024 * 1024 and not re.search(r"(?:gib|gb|mib|mb|kib|kb)", str(value), re.I):
        numeric *= 1024**2
    return numeric


def _powershell_gpu_data() -> list[tuple[str, int | None]]:
    script = (
        "Get-CimInstance Win32_VideoController | ForEach-Object { "
        "[PSCustomObject]@{Name=$_.Name; AdapterRAM=$_.AdapterRAM} } | "
        "ConvertTo-Json -Compress"
    )
    result = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script])
    if not result or result.returncode:
        result = _run(["pwsh", "-NoProfile", "-NonInteractive", "-Command", script])
    if not result or result.returncode:
        return []
    try:
        parsed = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        parsed = [parsed]
    output = []
    for item in parsed if isinstance(parsed, list) else []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("Name", "Unknown adapter"))
        memory = _read_hardware_bytes(item.get("AdapterRAM"))
        output.append((name, memory))
    return output


def scan_hardware(runner: Callable[[list[str], float], subprocess.CompletedProcess[str] | None] = _run) -> Hardware:
    """Best-effort hardware scan; only dedicated VRAM drives recommendations."""
    system = platform.system()
    machine = platform.machine()
    notes: list[str] = []
    ram: int | None = None
    cpu_name: str | None = platform.processor() or None
    if system == "Linux":
        ram = _read_linux_ram()
        cpu_name = _read_linux_cpu() or cpu_name
    elif system == "Darwin":
        result = runner(["sysctl", "-n", "hw.memsize"], 4)
        if result and result.returncode == 0:
            try:
                ram = int(result.stdout.strip())
            except ValueError:
                pass
        cpu = runner(["sysctl", "-n", "machdep.cpu.brand_string"], 4)
        if cpu and cpu.returncode == 0 and cpu.stdout.strip():
            cpu_name = cpu.stdout.strip()
        elif machine.lower() in {"arm64", "aarch64"}:
            cpu_name = "Apple Silicon (model name not exposed by sysctl)"
    elif system == "Windows":
        result = runner(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"], 8)
        if result and result.returncode == 0:
            try:
                ram = int(result.stdout.strip())
            except ValueError:
                pass
        cpu = runner(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)"], 8)
        if cpu and cpu.returncode == 0 and cpu.stdout.strip():
            cpu_name = cpu.stdout.strip()

    gpu_name: str | None = None
    vram_bytes: int | None = None
    if shutil.which("nvidia-smi"):
        result = runner(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], 8)
        if result and result.returncode == 0:
            gpus = []
            for line in result.stdout.splitlines():
                parts = [part.strip() for part in line.split(",", 1)]
                if len(parts) == 2:
                    try:
                        gpus.append((parts[0], int(parts[1]) * 1024**2))
                    except ValueError:
                        pass
            if gpus:
                gpu_name, vram_bytes = max(gpus, key=lambda item: item[1])
                if len(gpus) > 1:
                    notes.append("Recommendation uses the largest single NVIDIA GPU; multi-GPU memory is not added together.")
    if vram_bytes is None and system == "Linux" and shutil.which("rocm-smi"):
        result = runner(["rocm-smi", "--showmeminfo", "vram", "--json"], 8)
        if result and result.returncode == 0:
            try:
                parsed = json.loads(result.stdout)
                vram_bytes = _read_hardware_bytes(parsed)
                gpu_name = "AMD GPU (rocm-smi)" if vram_bytes else None
                if vram_bytes:
                    notes.append("AMD VRAM was parsed from rocm-smi output; confirm it against your system monitor.")
            except json.JSONDecodeError:
                notes.append("rocm-smi was present, but its VRAM output was not recognized.")
    if vram_bytes is None and system == "Windows":
        adapters = _powershell_gpu_data()
        if adapters:
            names = [name for name, _ in adapters]
            gpu_name = ", ".join(names)
            # WMI's AdapterRAM field is 32-bit on many Windows builds. Do not
            # base a tier recommendation on its possibly truncated value.
            if any(memory for _, memory in adapters):
                notes.append("Windows WMI reports adapter names but its AdapterRAM field can truncate at 4 GiB; it is not used for tier recommendations. Install/use nvidia-smi or verify with a trusted GPU utility.")
    apple_unified: int | None = None
    if system == "Darwin" and ram:
        apple_unified = ram
        notes.append("Apple Silicon uses unified memory, not dedicated VRAM. It is shown separately and does not select a VRAM tier.")
    if not gpu_name and system == "Darwin":
        result = runner(["system_profiler", "SPDisplaysDataType"], 12)
        if result and result.returncode == 0:
            names = re.findall(r"Chipset Model:\s*(.+)", result.stdout)
            gpu_name = ", ".join(name.strip() for name in names) or "Apple/Intel graphics (name not parsed)"
    if not gpu_name and not any("uncertain" in note.lower() for note in notes):
        notes.append("No reliable dedicated-VRAM reading was found. The wizard will not infer a tier from system RAM.")
    return Hardware(system, machine, cpu_name, ram, gpu_name, vram_bytes, apple_unified, notes)


def recommended_tier(vram_bytes: int | None) -> int | None:
    """Map known dedicated VRAM to the user's requested starter size tiers."""
    if not vram_bytes:
        return None
    gb = vram_bytes / (1024**3)
    # Some adapters report a few MiB below the marketed tier (e.g. 8188 MiB
    # for an 8 GiB card). A small tolerance keeps those devices in the intended
    # starter category; this is not a promise that a model/context will fit.
    if gb >= 23.75:
        return 27
    if gb >= 11.75:
        return 12
    if gb >= 7.75:
        return 9
    if gb >= 3.75:
        return 4
    return None


def eligible_tiers(vram_bytes: int | None) -> list[int]:
    current = recommended_tier(vram_bytes)
    return [tier for tier in (4, 9, 12, 27) if current is not None and tier <= current]


def hf_request(url: str, timeout: float = 30) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def resolve_q4_file(repo: str, fetch: Callable[[str], bytes] = hf_request) -> dict[str, Any]:
    """Find exact Q4_K_M GGUF file and metadata through the Hugging Face API."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Invalid model repository id.")
    url = f"{HF_API}/{urllib.parse.quote(repo, safe='/')}/tree/main?recursive=true&expand=true"
    tree = json.loads(fetch(url).decode("utf-8"))
    files = [entry for entry in tree if isinstance(entry, dict) and str(entry.get("path", "")).lower().endswith(".gguf")]
    matches = [entry for entry in files if re.search(r"(?:^|[-_.])q4_k_m(?:[-_.]|$)", Path(entry.get("path", "")).name, re.I)]
    if not matches:
        raise RuntimeError(f"No Q4_K_M GGUF file was found in {repo}.")
    # Choose the least ambiguous exact Q4_K_M filename; if multiple variants
    # exist, prefer the shortest filename, then ask the user at the TUI layer.
    matches.sort(key=lambda entry: (len(str(entry.get("path", ""))), str(entry.get("path", "")).lower()))
    selected = matches[0]
    path = str(selected["path"])
    lfs = selected.get("lfs") or {}
    sha256 = lfs.get("oid") if isinstance(lfs, dict) else None
    revision = selected.get("lastCommit", {}).get("id") if isinstance(selected.get("lastCommit"), dict) else None
    if not isinstance(revision, str) or not revision:
        raise RuntimeError(f"Hugging Face did not provide a pinned revision for {repo}/{path}.")
    return {
        "repo": repo,
        "file": path,
        "size": selected.get("size"),
        "sha256": sha256 if isinstance(sha256, str) and re.fullmatch(r"[a-fA-F0-9]{64}", sha256) else None,
        "revision": revision,
        "url": f"https://huggingface.co/{repo}/resolve/{urllib.parse.quote(revision, safe='')}/{urllib.parse.quote(path, safe='/')}?download=true",
    }


def download_with_progress(
    url: str,
    destination: Path,
    expected_size: int | None = None,
    expected_sha256: str | None = None,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> None:
    """Download atomically, resuming a partial file when the server supports Range."""
    import hashlib

    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    headers = {"User-Agent": USER_AGENT}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    req = urllib.request.Request(url, headers=headers)
    response = opener(req, timeout=60)
    status = getattr(response, "status", None) or response.getcode()
    if offset and status != 206:
        response.close()
        offset = 0
        partial.unlink(missing_ok=True)
        response = opener(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=60)
    content_length = response.headers.get("Content-Length")
    total = expected_size or (offset + int(content_length) if content_length and content_length.isdigit() else None)
    mode = "ab" if offset else "wb"
    downloaded = offset
    try:
        with response, partial.open(mode) as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                downloaded += len(chunk)
                if total:
                    percent = min(100, int(downloaded * 100 / total))
                    print(f"\rDownloading model: {percent:3d}% ({downloaded / 1024**3:.2f}/{total / 1024**3:.2f} GiB)", end="", flush=True)
                else:
                    print(f"\rDownloading model: {downloaded / 1024**3:.2f} GiB", end="", flush=True)
    except KeyboardInterrupt:
        print("\nDownload paused; rerun this launcher to resume.")
        raise
    print()
    if total and downloaded != total:
        raise RuntimeError(f"Incomplete download: received {downloaded} of {total} bytes. Partial file retained for resume.")
    if expected_sha256:
        digest = hashlib.sha256()
        with partial.open("rb") as source:
            for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest().lower() != expected_sha256.lower():
            partial.unlink(missing_ok=True)
            raise RuntimeError("The downloaded GGUF SHA-256 does not match Hugging Face metadata.")
    partial.replace(destination)


def _print_hardware(info: Hardware) -> None:
    print("\nSystem scan")
    print(f"  OS / architecture: {info.system or 'Unknown'} / {info.machine or 'Unknown'}")
    print(f"  CPU:               {info.cpu_name or 'unknown'}")
    if info.ram_bytes:
        print(f"  System RAM:        {info.ram_bytes / (1024**3):.1f} GiB")
    else:
        print("  System RAM:        unknown")
    print(f"  GPU:               {info.gpu_name or 'not detected'}")
    if info.dedicated_vram_gb is None:
        print("  Dedicated VRAM:    unknown")
    else:
        print(f"  Dedicated VRAM:    {info.dedicated_vram_gb:.1f} GiB (largest detected single GPU)")
    if info.apple_unified_memory_bytes:
        print(f"  Apple unified:     {info.apple_unified_memory_bytes / (1024**3):.1f} GiB (not counted as dedicated VRAM)")
    for note in info.notes or []:
        print(f"  Note: {note}")


def _read_key() -> str:
    """Read one portable menu key. Arrow keys are normalized to up/down."""
    if os.name == "nt":
        import msvcrt

        key = msvcrt.getwch()
        if key in {"\x00", "\xe0"}:
            return {"H": "up", "P": "down"}.get(msvcrt.getwch(), "")
        if key in {"\r", "\n"}:
            return "enter"
        if key == " ":
            return "space"
        if key == "\x1b":
            return "escape"
        if key == "\x03":
            raise KeyboardInterrupt
        return key.lower()

    import select
    import termios
    import tty

    stream = sys.stdin
    fd = stream.fileno()
    previous = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        key = os.read(fd, 1).decode("utf-8", errors="ignore")
        if key == "\x1b":
            sequence = ""
            for _ in range(2):
                ready, _, _ = select.select([fd], [], [], 0.08)
                if not ready:
                    break
                sequence += os.read(fd, 1).decode("ascii", errors="ignore")
            return {"[A": "up", "[B": "down"}.get(sequence, "escape")
        if key in {"\r", "\n"}:
            return "enter"
        if key == " ":
            return "space"
        if key == "\x03":
            raise KeyboardInterrupt
        return key.lower()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, previous)


def show_branding() -> None:
    """Print the shared peach and DanmuTalk wordmark used by run.py."""
    lines = []
    for name in ("ascii.txt", "bigtext.txt"):
        path = ROOT / name
        if path.is_file():
            lines.append(path.read_text(encoding="utf-8").rstrip())
    if not lines:
        return
    art = "\n".join(lines)
    if sys.stdout.isatty() and "NO_COLOR" not in os.environ:
        print(f"\033[38;2;253;240;119m{art}\033[0m")
    else:
        print(art)


def _select_menu(title: str, options: list[str], default: int = 0) -> int:
    """Arrow-key menu; space or enter confirms, q/escape cancels."""
    if not options:
        raise ValueError("A menu needs at least one option.")
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        for index, option in enumerate(options, 1):
            print(f"  {index}. {option}")
        return _input_choice(f"{title} (number): ", len(options))

    selected = min(max(default, 0), len(options) - 1)
    while True:
        sys.stdout.write("\033[2J\033[H")
        show_branding()
        print(title)
        print("↑ / ↓ move   Space / Enter select   q cancel\n")
        for index, option in enumerate(options):
            marker = "❯" if index == selected else " "
            print(f" {marker} {option}")
        sys.stdout.flush()
        key = _read_key()
        if key == "up":
            selected = (selected - 1) % len(options)
        elif key == "down":
            selected = (selected + 1) % len(options)
        elif key in {"space", "enter"}:
            return selected
        elif key in {"q", "escape"}:
            raise KeyboardInterrupt


def _target_architecture() -> str:
    """Resolve the native build target, including Apple Silicon under Rosetta."""
    machine = platform.machine().lower()
    if platform.system() == "Darwin":
        result = _run(["sysctl", "-n", "hw.optional.arm64"], timeout=3)
        if result and result.returncode == 0 and result.stdout.strip() == "1":
            return "arm64"
    if machine in {"x86_64", "amd64", "x64"}:
        return "x64"
    if machine in {"aarch64", "arm64"}:
        return "arm64"
    raise RuntimeError(f"llama.cpp helper does not have a configured build target for CPU architecture '{machine}'.")


def _download_llama_source(source_dir: Path) -> None:
    """Download and safely extract the official llama.cpp source archive."""
    source_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="danmutalk-llama-source-") as temporary:
        temporary_dir = Path(temporary)
        archive_path = temporary_dir / "llama.cpp.tar.gz"
        request = urllib.request.Request(LLAMA_SOURCE_URL, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response, archive_path.open("wb") as output:
            total_text = response.headers.get("Content-Length", "")
            total = int(total_text) if total_text.isdigit() else None
            received = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                received += len(chunk)
                if total:
                    print(f"\rDownloading llama.cpp source: {min(100, received * 100 // total):3d}%", end="", flush=True)
                else:
                    print(f"\rDownloading llama.cpp source: {received / 1024**2:.1f} MiB", end="", flush=True)
        print()

        extract_root = temporary_dir / "extract"
        extract_root.mkdir()
        with tarfile.open(archive_path, "r:gz") as archive:
            members = archive.getmembers()
            for member in members:
                path = Path(member.name)
                if path.is_absolute() or ".." in path.parts or not (member.isdir() or member.isfile()):
                    raise RuntimeError(f"Unsafe or unsupported entry in llama.cpp source archive: {member.name}")
            archive.extractall(extract_root, members=members)
        candidates = list(extract_root.iterdir())
        source_root = next((path for path in candidates if path.is_dir() and (path / "CMakeLists.txt").is_file()), None)
        if source_root is None:
            raise RuntimeError("The llama.cpp source archive did not contain its root CMakeLists.txt.")
        if source_dir.exists():
            shutil.rmtree(source_dir)
        shutil.move(str(source_root), str(source_dir))


def _llama_build_options(architecture: str | None = None) -> list[str]:
    """Select native CPU and available GPU backend options for this machine."""
    architecture = architecture or _target_architecture()
    if architecture not in {"x64", "arm64"}:
        raise ValueError(f"Unsupported llama.cpp build architecture: {architecture}")
    options = ["-DCMAKE_BUILD_TYPE=Release", "-DLLAMA_BUILD_SERVER=ON", "-DGGML_NATIVE=ON"]
    system = platform.system()
    if system == "Darwin":
        options.extend(["-DGGML_METAL=ON", f"-DCMAKE_OSX_ARCHITECTURES={architecture}"])
    elif shutil.which("nvcc") and shutil.which("nvidia-smi"):
        options.append("-DGGML_CUDA=ON")
    elif system == "Linux" and shutil.which("hipcc") and shutil.which("rocm-smi"):
        options.append("-DGGML_HIP=ON")
    if system == "Windows" and not os.environ.get("CMAKE_GENERATOR"):
        options.extend(["-A", "ARM64" if architecture == "arm64" else "x64"])
    return options


def _llama_build_environment() -> dict[str, str]:
    """Prepare ROCm's compiler paths when the HIP backend is available."""
    environment = os.environ.copy()
    if platform.system() != "Linux" or not (shutil.which("hipcc") and shutil.which("rocm-smi")):
        return environment
    hipconfig = shutil.which("hipconfig")
    if not hipconfig:
        return environment
    compiler = _run([hipconfig, "-l"], timeout=8)
    root = _run([hipconfig, "-R"], timeout=8)
    if compiler and compiler.returncode == 0 and root and root.returncode == 0:
        clang_dir = compiler.stdout.strip()
        hip_root = root.stdout.strip()
        if clang_dir and hip_root:
            environment.setdefault("HIPCXX", str(Path(clang_dir) / "clang"))
            environment.setdefault("HIP_PATH", hip_root)
    return environment


def _build_llama_cpp() -> str:
    """Compile llama.cpp locally for the detected CPU architecture/backends."""
    cmake = shutil.which("cmake")
    if not cmake:
        raise RuntimeError("CMake is required to build llama.cpp. Install CMake and a C/C++ compiler, then rerun this helper. See https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md")
    architecture = _target_architecture()
    source_dir = LOCAL_MODELS / "llama.cpp"
    if not (source_dir / "CMakeLists.txt").is_file():
        print("Downloading official llama.cpp source from ggml-org/llama.cpp…")
        _download_llama_source(source_dir)
    build_dir = source_dir / "build"
    options = _llama_build_options(architecture)
    environment = _llama_build_environment()
    print(f"Configuring llama.cpp source build for {platform.system()} {architecture}…")
    print(f"CMake: {cmake} -S {source_dir} -B {build_dir} {' '.join(options)}")
    subprocess.run([cmake, "-S", str(source_dir), "-B", str(build_dir), *options], cwd=str(ROOT), env=environment, check=True)
    jobs = max(1, min(8, (os.cpu_count() or 2) - 1))
    print(f"Building llama.cpp (Release), using {jobs} parallel job(s)…")
    subprocess.run([cmake, "--build", str(build_dir), "--config", "Release", "--parallel", str(jobs), "--target", "llama-server"], cwd=str(ROOT), env=environment, check=True)
    binary = _find_server()
    if not binary:
        raise RuntimeError("llama.cpp built but llama-server was not found in its build output.")
    return binary


def _input_choice(prompt: str, maximum: int) -> int:
    while True:
        raw = input(prompt).strip()
        if raw.lower() in {"q", "quit"}:
            raise KeyboardInterrupt
        if raw.isdigit() and 1 <= int(raw) <= maximum:
            return int(raw) - 1
        print(f"Enter a number from 1 to {maximum}, or q to quit.")


def write_launcher(config: dict[str, Any], directory: Path = LOCAL_MODELS) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    launcher = directory / f"{config['slug']}.py"
    source = (
        "#!/usr/bin/env python3\n"
        "\"\"\"Generated DanmuTalk model launcher.\"\"\"\n"
        "from pathlib import Path\nimport sys\n"
        "ROOT = Path(__file__).resolve().parents[1]\n"
        "sys.path.insert(0, str(ROOT))\n"
        "from tools.local_llm_setup import launch_configured_model\n"
        f"CONFIG = {config!r}\n"
        "if __name__ == '__main__':\n    launch_configured_model(CONFIG)\n"
    )
    launcher.write_text(source, encoding="utf-8")
    try:
        launcher.chmod(0o755)
    except OSError:
        pass
    return launcher


def run_setup() -> Path | None:
    show_branding()
    print("DanmuTalk local model setup\nThis wizard inspects hardware and creates a launcher. Model weights are not downloaded now.")
    hardware = scan_hardware()
    _print_hardware(hardware)
    tier = recommended_tier(hardware.dedicated_vram_bytes)
    if tier:
        print(f"\nSuggested maximum starter tier from dedicated VRAM: {tier}B.")
        print("This is a rough recommendation, not a fit guarantee. Context/KV cache and other GPU use need extra memory.")
    else:
        print("\nNo VRAM tier can be recommended from this scan. You may still choose a CPU/partial-offload model manually.")

    language = ("en", "ko")[_select_menu("Preferred RP language", ["English", "Korean"])]
    options = [model for model in MODEL_CATALOG if model.language == language]
    if tier is not None:
        options = [model for model in options if model.tier_gb <= tier]
    if not options:
        options = [model for model in MODEL_CATALOG if model.language == language and model.tier_gb == 4]
        print("No model fits the scanned VRAM tiers. Showing 4B options for CPU/partial-GPU use only.")
    model_labels = []
    for model in options:
        recommendation = " — recommended" if model.tier_gb == tier else ""
        model_labels.append(f"{model.tier_gb}B — {model.name}{recommendation}")
    selected = options[_select_menu(f"{ 'Korean' if language == 'ko' else 'English' } models · Q4_K_M", model_labels)]
    print(f"\n{selected.note}\nLicense: {selected.license_name}; {selected.license_url}")
    if hardware.dedicated_vram_gb is None or hardware.dedicated_vram_gb < selected.tier_gb:
        print("\nWarning: this choice exceeds the detected dedicated-VRAM tier (or VRAM was unknown).")
        print("The server may fall back to CPU/offload, reduce context, or fail to load. System RAM is not a substitute for VRAM speed.")
        if _select_menu("Continue with this choice?", ["Cancel", "Continue anyway"], default=0) != 1:
            return None

    print(f"\nLooking up Q4_K_M file in {selected.repo} (metadata only)...")
    file_info = resolve_q4_file(selected.repo)
    size = file_info.get("size")
    if isinstance(size, int):
        print(f"Model file: {file_info['file']} ({size / (1024**3):.2f} GiB)")
    else:
        print(f"Model file: {file_info['file']} (size unavailable from API)")
    print(f"License reference: {selected.license_name}\n{selected.license_url}")
    config = {
        **asdict(selected),
        "file": file_info["file"],
        "file_size": file_info.get("size"),
        "sha256": file_info.get("sha256"),
        "download_url": file_info["url"],
        "revision": file_info.get("revision"),
    }
    launcher = write_launcher(config)
    print(f"\nCreated launcher: {launcher}")
    print(f"Run it with: {sys.executable} \"{launcher.relative_to(ROOT)}\"")
    print("The GGUF downloads on first launch. Keep the launcher inside this installation so it can import its setup helper.")
    print("Building llama.cpp from source for this computer's architecture and detected GPU backend.")
    _build_llama_cpp()
    return launcher


def _find_server() -> str | None:
    candidates = [
        LOCAL_MODELS / "llama.cpp" / "build" / "bin" / "Release" / "llama-server.exe",
        LOCAL_MODELS / "llama.cpp" / "build" / "bin" / "Release" / "llama-server",
        LOCAL_MODELS / "llama.cpp" / "build" / "bin" / "llama-server.exe",
        LOCAL_MODELS / "llama.cpp" / "build" / "bin" / "llama-server",
    ]
    for path in candidates:
        if path.is_file():
            return str(path)
    return None


def _ensure_server() -> str | None:
    binary = _find_server()
    if binary:
        return binary
    print("llama-server is missing; building it from the official source now.")
    return _build_llama_cpp()


def _available_port(host: str = "127.0.0.1", first: int = 8080, last: int = 8199) -> int:
    import socket

    for port in range(first, last + 1):
        with socket.socket() as sock:
            try:
                sock.bind((host, port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free local port found between {first} and {last}.")


def _health_ready(url: str, process: subprocess.Popen[Any], timeout_seconds: int = 900) -> bool:
    deadline = time.monotonic() + timeout_seconds
    health_url = f"{url}/health"
    while process.poll() is None and time.monotonic() < deadline:
        try:
            request = urllib.request.Request(health_url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=2) as response:
                if response.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(2)
    return False


def launch_configured_model(config: dict[str, Any]) -> None:
    show_branding()
    print(f"Model: {config['name']} — {config['repo']}\nLicense: {config['license_name']}\n{config['license_url']}")
    binary = _ensure_server()
    if not binary:
        return
    model_path = LOCAL_MODELS / "cache" / str(config["slug"]) / Path(str(config["file"])).name
    if not model_path.exists():
        print("This is the first launch; the Q4_K_M model will download now.")
        print("Check the license and available disk space before continuing.")
        if isinstance(config.get("file_size"), int):
            free = shutil.disk_usage(LOCAL_MODELS).free
            need = int(config["file_size"])
            print(f"Model file: {need / (1024**3):.2f} GiB; free disk space: {free / (1024**3):.2f} GiB.")
            if free < need + 512 * 1024**2:
                print("Available disk space is below the model size plus 512 MiB working margin.")
                if _select_menu("Try the download anyway?", ["Cancel", "Continue anyway"], default=0) != 1:
                    return
        else:
            print(f"Model file: {config['file']}")
        if _select_menu("Download model weights now?", ["Not now", "Download"], default=0) != 1:
            return
        download_with_progress(str(config["download_url"]), model_path, config.get("file_size"), config.get("sha256"))
    elif config.get("file_size") and model_path.stat().st_size != int(config["file_size"]):
        print("Cached model has the wrong size; re-downloading it.")
        model_path.unlink()
        download_with_progress(str(config["download_url"]), model_path, config.get("file_size"), config.get("sha256"))
    help_result = _run([binary, "--help"], 10)
    help_text = (help_result.stdout + help_result.stderr) if help_result else ""
    port = _available_port()
    endpoint = f"http://127.0.0.1:{port}/v1"
    command = [binary, "--model", str(model_path), "--host", "127.0.0.1", "--port", str(port), "--n-gpu-layers", "auto"]
    if "--alias" in help_text:
        command.extend(["--alias", str(config["slug"])])
    context_size = {4: 8192, 9: 16384, 12: 24576, 27: 32768}.get(int(config["tier_gb"]), 8192)
    command.extend(["--ctx-size", str(context_size)])
    if "--fit" in help_text:
        command.extend(["--fit", "on", "--fit-ctx", str(context_size)])
    else:
        print(f"This llama.cpp build lacks --fit; using {context_size:,}-token context. GPU offload may need manual adjustment.")
    print("Starting llama-server on loopback only; server logs follow.")
    print("VRAM/context sizing is best-effort; real availability depends on other GPU workloads and backend support.")
    process = subprocess.Popen(command, cwd=str(ROOT))
    try:
        if _health_ready(endpoint, process):
            print(f"\nModel is ready. OpenAI-compatible endpoint: {endpoint}")
            model_id = str(config["slug"])
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/models", timeout=5) as response:
                    models = json.loads(response.read().decode("utf-8")).get("data", [])
                    if models and isinstance(models[0], dict) and models[0].get("id"):
                        model_id = str(models[0]["id"])
            except (urllib.error.URLError, TimeoutError, OSError, ValueError):
                pass
            print(f"Model id for DanmuTalk: {model_id}")
            print("Enter this endpoint and model id in DanmuTalk settings.")
            process.wait()
        else:
            if process.poll() is None:
                print("\nServer did not become ready before the 15-minute timeout; see logs above.")
            else:
                print(f"\nllama-server exited with code {process.returncode}; see logs above.")
    except KeyboardInterrupt:
        print("\nStopping local model server…")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def main() -> int:
    try:
        run_setup()
        return 0
    except KeyboardInterrupt:
        print("\nCancelled.")
        return 130
    except (OSError, RuntimeError, urllib.error.URLError, json.JSONDecodeError, ValueError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f"Setup failed: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            print("The source build could not complete. Check the CMake/compiler output and the official llama.cpp build guide.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
