#!/usr/bin/env python3
"""App-facing local adapter for selected CrispASR TTS runtimes."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import shutil
import tempfile
import threading
import time
import subprocess
import signal
import uuid
import urllib.error
import urllib.request
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ENGINE = os.environ.get('WORLD_PLAYER_TTS_ENGINE', 'voxcpm2').lower()
HOST = os.environ.get('QWEN_TTS_HOST', '127.0.0.1')
PORT = int(os.environ.get('QWEN_TTS_PORT', '8175'))
CRISP_BINARY = os.environ.get('WORLD_PLAYER_CRISPASR_BINARY', 'crispasr')
MODEL_IDS = {
    'voxcpm2': 'cstr/voxcpm2-GGUF · Q8_0',
}
EXPECTED_VRAM_MB = {'voxcpm2': 4588}
CRISP_BACKENDS = {'voxcpm2': 'voxcpm2-tts'}
VOICE_CLONING_ENGINES = {'voxcpm2'}
MODEL_LANGUAGES = {'voxcpm2': {'ja', 'en', 'ko'}}
MODEL_SELECTORS: dict[str, str] = {}
if ENGINE not in MODEL_IDS:
    raise RuntimeError(f'Unsupported voice model: {ENGINE}')

MODEL = None
CONFIGURED = False
MODEL_LOCK = threading.RLock()
LOAD_STATUS_LOCK = threading.Lock()
PROGRESS_LOCK = threading.Lock()
LOAD_STATUS = {'state': 'idle', 'stage': '', 'model': '', 'percent': 0, 'detail': ''}
PROGRESS: OrderedDict[str, dict] = OrderedDict()
CANCELLED: OrderedDict[str, float] = OrderedDict()
CRISP_PROCESS: subprocess.Popen | None = None
CRISP_PORT = PORT + 1
VOICE_LANGUAGE = 'ja'
CLONING_CONSENT = False
REGISTERED_VOICES: set[str] = set()


def set_load_status(state: str, stage: str, percent: int, detail: str) -> None:
    with LOAD_STATUS_LOCK:
        LOAD_STATUS.update(state=state, stage=stage, model=MODEL_IDS[ENGINE], percent=percent, detail=detail)


def progress_for(request_id: str, stage: str) -> dict:
    now = time.monotonic()
    with PROGRESS_LOCK:
        item = PROGRESS.setdefault(request_id, {'started': now})
        item.update(stage=stage, updated=now)
        PROGRESS.move_to_end(request_id)
        while len(PROGRESS) > 32:
            PROGRESS.popitem(last=False)
        return {'stage': stage, 'elapsedMs': round((now - item['started']) * 1000)}


def prune_crisp_voice_cache(voice_dir: Path, keep: Path) -> None:
    files = sorted(voice_dir.glob('worldplayer-*.wav'), key=lambda path: path.stat().st_mtime, reverse=True)
    total = 0
    retained = 0
    for path in files:
        size = path.stat().st_size
        if path == keep or (retained < 180 and total + size <= 160 * 1024 * 1024):
            retained += 1
            total += size
            continue
        try:
            path.unlink()
            REGISTERED_VOICES.discard(path.stem)
        except OSError:
            pass


def unload() -> None:
    global MODEL, CONFIGURED, CRISP_PROCESS
    with MODEL_LOCK:
        if CRISP_PROCESS and CRISP_PROCESS.poll() is None:
            CRISP_PROCESS.terminate()
            try: CRISP_PROCESS.wait(timeout=8)
            except subprocess.TimeoutExpired:
                CRISP_PROCESS.kill()
                CRISP_PROCESS.wait(timeout=3)
        CRISP_PROCESS = None
        REGISTERED_VOICES.clear()
        MODEL = None
        CONFIGURED = False
        set_load_status('idle', '', 0, 'Voice model is unloaded')


def gpu_status() -> dict:
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=2, check=True)
        name, total, used, free = result.stdout.strip().splitlines()[0].split(',')
        process_memory = 0
        try:
            apps = subprocess.run(['nvidia-smi', '--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=2, check=True)
            owned_pids = {os.getpid()}
            if CRISP_PROCESS is not None and CRISP_PROCESS.poll() is None:
                owned_pids.add(CRISP_PROCESS.pid)
            for row in apps.stdout.splitlines():
                fields = [part.strip() for part in row.split(',')]
                if len(fields) >= 2 and fields[0].isdigit() and int(fields[0]) in owned_pids and fields[1].isdigit():
                    process_memory += int(fields[1])
        except Exception:
            pass
        return {'device': name.strip(), 'totalVramMB': int(total.strip()), 'usedVramMB': int(used.strip()), 'availableVramMB': int(free.strip()), 'processVramMB': process_memory or None, 'acceleratorBackend': 'CUDA', 'acceleratorAvailable': True}
    except Exception:
        pass
    if ENGINE in CRISP_BACKENDS:
        try:
            result = subprocess.run(['rocm-smi', '--showproductname', '--showmeminfo', 'vram'], capture_output=True, text=True, timeout=3, check=True)
            output = result.stdout
            memory_values = [int(value) for value in __import__('re').findall(r'(?:Total Memory|Used Memory)\s*\(B\)\s*:\s*(\d+)', output, __import__('re').I)]
            total = memory_values[0] // (1024 * 1024) if memory_values else 0
            used = memory_values[1] // (1024 * 1024) if len(memory_values) > 1 else 0
            name = next((line.split(':', 1)[1].strip() for line in output.splitlines() if 'Card series' in line or 'Product Name' in line), 'AMD GPU')
            return {'device': name, 'totalVramMB': total, 'availableVramMB': max(0, total - used) if total else 0, 'acceleratorBackend': 'ROCm', 'acceleratorAvailable': True}
        except Exception:
            try:
                subprocess.run(['vulkaninfo', '--summary'], capture_output=True, text=True, timeout=3, check=True)
                return {'device': 'Vulkan GPU', 'totalVramMB': 0, 'availableVramMB': 0, 'acceleratorBackend': 'Vulkan', 'acceleratorAvailable': True}
            except Exception:
                pass
        return {'device': 'CPU', 'totalVramMB': 0, 'availableVramMB': 0, 'acceleratorBackend': 'CPU', 'acceleratorAvailable': False}


def crisp_health() -> bool:
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{CRISP_PORT}/health', timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def register_crisp_voice(name: str, audio: bytes, transcript: str) -> None:
    boundary = f'----WorldPlayerVoice{uuid.uuid4().hex}'
    parts = [
        (f'--{boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n{name}\r\n').encode(),
        (f'--{boundary}\r\nContent-Disposition: form-data; name="consent_attestation"\r\n\r\nI have permission to use this reference audio for voice cloning.\r\n').encode(),
        (f'--{boundary}\r\nContent-Disposition: form-data; name="transcript"\r\n\r\n{transcript}\r\n').encode(),
        (f'--{boundary}\r\nContent-Disposition: form-data; name="voice"; filename="reference.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode(),
        audio,
        f'\r\n--{boundary}--\r\n'.encode(),
    ]
    request = urllib.request.Request(
        f'http://127.0.0.1:{CRISP_PORT}/v1/voices?force=true',
        data=b''.join(parts),
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status not in {200, 201}:
                raise RequestError(502, f'CrispASR voice registration returned HTTP {response.status}.')
    except urllib.error.HTTPError as error:
        detail = error.read(2048).decode(errors='replace')
        raise RequestError(error.code, detail or f'CrispASR voice registration returned HTTP {error.code}.')
    REGISTERED_VOICES.add(name)


def start_crispasr(language: str) -> None:
    global CRISP_PROCESS
    backend = CRISP_BACKENDS[ENGINE]
    cache = Path(os.environ.get('WORLD_PLAYER_CACHE', Path.home() / '.cache' / 'world-player')) / 'crispasr'
    voice_dir = cache / 'voices'
    voice_dir.mkdir(parents=True, exist_ok=True)
    model_selector = MODEL_SELECTORS.get(ENGINE, 'auto:q8_0')
    command = [CRISP_BINARY, '--server', '--backend', backend, '-m', model_selector, '--host', '127.0.0.1', '--port', str(CRISP_PORT), '-l', language, '--voice-dir', str(voice_dir), '--accept-marking-responsibility', '--no-warmup']
    set_load_status('loading', 'downloading_model', 5, f'Downloading model files for {backend}')
    # VoxCPM2 in CrispASR resolves a reference passed through its HTTP `voice`
    # field as a relative WAV path. Run it from the voice directory so the
    # safe basename used in requests resolves to the uploaded reference file.
    CRISP_PROCESS = subprocess.Popen(command, cwd=voice_dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    def read_log() -> None:
        assert CRISP_PROCESS is not None and CRISP_PROCESS.stdout is not None
        for line in CRISP_PROCESS.stdout:
            line = line.strip()
            match = __import__('re').search(r'(\d{1,3})\s*%', line)
            if match:
                percent = max(5, min(95, int(match.group(1))))
                set_load_status('loading', 'downloading_model', percent, line[-180:])
            elif any(word in line.lower() for word in ('load', 'download', 'model')):
                set_load_status('loading', 'loading_model', 10, line[-180:])
            if line:
                print(f'[CrispASR] {line}', flush=True)

    threading.Thread(target=read_log, daemon=True).start()
    for _ in range(1800):
        if CRISP_PROCESS.poll() is not None:
            raise RequestError(503, f'CrispASR exited before loading {backend}; see service log for details.')
        if crisp_health():
            return
        time.sleep(0.5)
    raise RequestError(504, f'Timed out while downloading or loading {backend}.')


class RequestError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Handler(BaseHTTPRequestHandler):
    server_version = 'WorldPlayerVoice/1.0'

    def _cors(self) -> None:
        origin = self.headers.get('Origin', '')
        host = urlparse(origin).hostname if origin else None
        if origin and (host in {'localhost', '127.0.0.1', '::1'} or origin.startswith('tauri://')):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Expose-Headers', 'X-World-Player-TTS-Truncated, X-World-Player-TTS-Tokens')

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _local_origin(self) -> bool:
        origin = self.headers.get('Origin', '')
        if not origin or origin.startswith('tauri://'):
            return True
        return urlparse(origin).hostname in {'localhost', '127.0.0.1', '::1'}

    def _payload(self, max_bytes: int) -> dict:
        size = int(self.headers.get('Content-Length', '0'))
        if size <= 0 or size > max_bytes:
            raise RequestError(413, 'Invalid request size')
        payload = json.loads(self.rfile.read(size))
        if not isinstance(payload, dict):
            raise RequestError(400, 'Request must be an object')
        return payload

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == '/health':
            with LOAD_STATUS_LOCK:
                load_status = dict(LOAD_STATUS)
            gpu = gpu_status()
            return self._json(200, {
                'ok': True, 'engine': ENGINE, 'model': MODEL_IDS[ENGINE],
                'ttsLoaded': MODEL is not None or (CRISP_PROCESS is not None and CRISP_PROCESS.poll() is None), 'configured': CONFIGURED,
                'loadStatus': load_status,
                **gpu,
                'expectedTtsVramMB': EXPECTED_VRAM_MB[ENGINE],
                'progressTokensSupported': False,
            })
        if parsed.path == '/progress':
            request_id = parse_qs(parsed.query).get('requestId', [''])[0]
            with PROGRESS_LOCK:
                item = PROGRESS.get(request_id)
                if not item:
                    return self._json(200, {'stage': 'starting', 'elapsedMs': 0})
                return self._json(200, {'stage': item['stage'], 'elapsedMs': round((time.monotonic() - item['started']) * 1000)})
        self._json(404, {'error': 'not found'})

    def do_POST(self) -> None:
        if not self._local_origin():
            return self._json(403, {'error': 'Only local application origins may access this service.'})
        path = urlparse(self.path).path
        if path == '/configure':
            return self._configure()
        if path == '/unload':
            unload()
            return self._json(200, {'ok': True, 'loaded': False})
        if path == '/cancel':
            try:
                request_id = str(self._payload(4096).get('requestId', '')).strip()
            except RequestError as error:
                return self._json(error.status, {'error': str(error)})
            if not request_id or len(request_id) > 100:
                return self._json(400, {'error': 'Invalid requestId'})
            with PROGRESS_LOCK:
                CANCELLED[request_id] = time.monotonic()
                CANCELLED.move_to_end(request_id)
                while len(CANCELLED) > 128:
                    CANCELLED.popitem(last=False)
            return self._json(200, {'cancelled': True})
        if path != '/generate':
            return self._json(404, {'error': 'not found'})
        return self._generate()

    def _configure(self) -> None:
        global MODEL, CONFIGURED, VOICE_LANGUAGE, CLONING_CONSENT
        try:
            payload = self._payload(128 * 1024)
            enabled = bool(payload.get('ttsEnabled', False))
            if not enabled:
                unload()
                return self._json(200, {'ok': True, 'ttsLoaded': False})
            selected_engine = str(payload.get('engine', ENGINE))
            if selected_engine != ENGINE:
                raise RequestError(409, f'The service runs {ENGINE}; restart it to use {selected_engine}.')
            language = str(payload.get('language', 'ja'))
            if language not in MODEL_LANGUAGES[ENGINE]:
                raise RequestError(400, 'Voice language must be ja, en, or ko.')
            CLONING_CONSENT = bool(payload.get('cloningConsent', False))
            if not CLONING_CONSENT:
                raise RequestError(403, 'Confirm that you have permission to clone the included reference voices before enabling voice generation.')
            set_load_status('loading', 'loading_model', 5, f'Loading {MODEL_IDS[ENGINE]}')
            with MODEL_LOCK:
                if ENGINE in CRISP_BACKENDS:
                    if CRISP_PROCESS and CRISP_PROCESS.poll() is None and CONFIGURED and VOICE_LANGUAGE == language:
                        pass
                    else:
                        unload()
                        set_load_status('loading', 'downloading_model', 5, f'Downloading {MODEL_IDS[ENGINE]}')
                        start_crispasr(language)
                    MODEL = True
                else:
                    raise RequestError(501, f'{ENGINE} is not available in the selected local runtime.')
                CONFIGURED = True
                VOICE_LANGUAGE = language
                set_load_status('ready', 'ready', 100, 'Voice model is ready')
            gpu = gpu_status()
            total = gpu['totalVramMB']
            free = gpu['availableVramMB']
            self._json(200, {'ok': True, 'ttsLoaded': True, 'engine': ENGINE, 'expectedVramMB': EXPECTED_VRAM_MB[ENGINE], **gpu, 'warning': bool(total and (EXPECTED_VRAM_MB[ENGINE] + 500 > total or free < 500))})
        except RequestError as error:
            set_load_status('error', 'error', 0, str(error)[:300])
            self._json(error.status, {'error': str(error)[:500]})
        except Exception as error:
            unload()
            set_load_status('error', 'error', 0, str(error)[:300])
            self._json(500, {'error': str(error)[:500]})

    def _generate(self) -> None:
        request_id = ''
        try:
            if not CONFIGURED or MODEL is None:
                raise RequestError(409, 'Voice model is not loaded. Enable voice generation in settings first.')
            if not CLONING_CONSENT:
                raise RequestError(403, 'Voice cloning is disabled until you confirm that you have permission to use the included reference voices.')
            payload = self._payload(24 * 1024 * 1024)
            text = str(payload.get('text', '')).strip()
            ref_text = str(payload.get('referenceText', '')).strip()
            request_id = str(payload.get('requestId', '')).strip()
            encoded = str(payload.get('referenceAudioBase64', ''))
            language = str(payload.get('language', VOICE_LANGUAGE))
            style = str(payload.get('style', '')).strip()[:240]
            if not request_id or len(request_id) > 100:
                raise RequestError(400, 'requestId is required')
            if not text or len(text) > 5000 or len(ref_text) > 10000:
                raise RequestError(400, 'Speech text is required and reference transcript must be under 10,000 characters.')
            if language not in {'ja', 'en', 'ko'}:
                raise RequestError(400, 'Voice language must be ja, en, or ko.')
            audio = base64.b64decode(encoded, validate=True)
            if not audio or len(audio) > 16 * 1024 * 1024:
                raise RequestError(413, 'Reference audio must be between 1 byte and 16 MiB')
            with PROGRESS_LOCK:
                CANCELLED.pop(request_id, None)
            progress_for(request_id, 'preparing_reference')
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as ref_file:
                ref_file.write(audio)
                ref_path = ref_file.name
            try:
                progress_for(request_id, 'synthesis')
                with MODEL_LOCK:
                    if ENGINE in CRISP_BACKENDS:
                        if ENGINE == 'voxcpm2' and style:
                            text = f'({style}) {text}'
                        voice_id = f'worldplayer-{hashlib.sha256(Path(ref_path).read_bytes()).hexdigest()[:20]}'
                        voice_dir = Path(os.environ.get('WORLD_PLAYER_CACHE', Path.home() / '.cache' / 'world-player')) / 'crispasr' / 'voices'
                        voice_dir.mkdir(parents=True, exist_ok=True)
                        voice_file = voice_dir / f'{voice_id}.wav'
                        if not voice_file.exists():
                            shutil.copyfile(ref_path, voice_file)
                        else:
                            voice_file.touch()
                        if ENGINE in VOICE_CLONING_ENGINES and voice_id not in REGISTERED_VOICES:
                            register_crisp_voice(voice_id, voice_file.read_bytes(), ref_text)
                        prune_crisp_voice_cache(voice_dir, voice_file)
                        if ENGINE == 'dia-1.6b':
                            text = f'[S1] {text}'
                        speech_payload = {
                            'input': text, 'model': CRISP_BACKENDS[ENGINE], **({'voice': f'{voice_id}.wav'} if ENGINE in VOICE_CLONING_ENGINES else {}),
                            'language': language, 'source_lang': 'ja', 'ref_text': ref_text,
                            'consent_attestation': 'I confirm that I have permission to use this reference audio for voice cloning.',
                            'spoken_disclaimer': False,
                            'marking_attestation': 'World Player marks generated voice messages as AI-generated in its interface.',
                        }
                        request = urllib.request.Request(f'http://127.0.0.1:{CRISP_PORT}/v1/audio/speech', data=json.dumps(speech_payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
                        try:
                            with urllib.request.urlopen(request, timeout=900) as response:
                                output_bytes = response.read()
                        except urllib.error.HTTPError as error:
                            detail = error.read(2048).decode(errors='replace')
                            raise RequestError(error.code, detail or f'CrispASR returned HTTP {error.code}.')
                    else:
                        raise RequestError(501, f'{ENGINE} is not available in the selected local runtime.')
                if request_id in CANCELLED:
                    raise RequestError(409, 'Voice generation was cancelled')
            finally:
                Path(ref_path).unlink(missing_ok=True)
            body = output_bytes
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-World-Player-TTS-Truncated', 'false')
            self.end_headers()
            self.wfile.write(body)
            progress_for(request_id, 'complete')
        except RequestError as error:
            self._json(error.status, {'error': str(error)[:500]})
        except Exception as error:
            self._json(500, {'error': str(error)[:500]})

    def log_message(self, fmt: str, *args: object) -> None:
        print(f'{self.address_string()} - {fmt % args}', flush=True)


print(f'Voice service ready at http://{HOST}:{PORT} for {ENGINE}; model loads after voice is enabled.', flush=True)
server = ThreadingHTTPServer((HOST, PORT), Handler)

def _terminate_worker(_signum: int, _frame: object) -> None:
    unload()
    raise SystemExit(0)

signal.signal(signal.SIGTERM, _terminate_worker)
try:
    server.serve_forever(poll_interval=0.5)
finally:
    unload()
