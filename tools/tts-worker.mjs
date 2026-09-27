import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, access, readdir, writeFile } from 'node:fs/promises';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let worker;
let setupProcess;
let startup;
let workerEngine;
let lastOutput = '';

function cacheDirectory() {
  return process.env.WORLD_PLAYER_CACHE
    ?? (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? homedir(), 'WorldPlayer', 'cache')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches', 'WorldPlayer')
        : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'world-player'));
}

async function readHealth(endpoint) {
  try {
    const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return undefined;
    const health = await response.json();
    return health?.ok ? health : undefined;
  } catch { return undefined; }
}

function run(executable, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const { setup = false, ...spawnOptions } = options;
    const child = spawn(executable, args, { cwd: projectRoot, ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] });
    if (setup) setupProcess = child;
    let output = '';
    const collect = chunk => { output = `${output}${chunk}`.slice(-4000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', rejectRun);
    child.on('exit', (code, signal) => {
      if (setupProcess === child) setupProcess = undefined;
      if (code === 0) resolveRun(output.trim());
      else rejectRun(new Error(`${executable} ${args.join(' ')} failed (${signal ?? code}). ${output.trim()}`));
    });
  });
}

async function pythonForWorker(engine) {
  if (process.env.WORLD_PLAYER_TTS_PYTHON) return process.env.WORLD_PLAYER_TTS_PYTHON;
  let crispCuda = false;
  if (process.platform === 'linux') {
    try { await run('nvidia-smi', ['-L']); crispCuda = true; } catch { /* CPU-only or another accelerator runtime. */ }
  }
  const moduleCheck = 'import sys; assert sys.version_info >= (3, 10)';
  const pythonCandidates = process.platform === 'win32'
    ? [['py', '-3.12'], ['python']]
    : [['python3.12'], ['python3'], ['python']];
  let pythonCommand;
  try {
    const uvPython = await run('uv', ['python', 'find', '3.12']);
    await run(uvPython, ['-c', 'import sys; assert (3, 10) <= sys.version_info[:2] <= (3, 12)']);
    pythonCommand = { command: uvPython, prefix: [] };
  } catch { /* uv or a cached managed interpreter may not be available. */ }
  for (const [command, ...prefix] of pythonCandidates) {
    if (pythonCommand) break;
    try {
      await run(command, [...prefix, '-c', 'import sys; assert (3, 10) <= sys.version_info[:2] <= (3, 12)']);
      pythonCommand = { command, prefix };
      break;
    } catch { /* Try another installed interpreter. */ }
  }
  if (!pythonCommand) throw new Error(`The ${engine} runtime needs Python 3.10–3.12. Install one of those versions, then retry.`);
  const cacheRoot = cacheDirectory();
  const environment = join(cacheRoot, 'crispasr-venv');
  const python = process.platform === 'win32' ? join(environment, 'Scripts', 'python.exe') : join(environment, 'bin', 'python');
  try {
    await run(python, ['-c', moduleCheck]);
    if (crispCuda) await run(python, ['-c', 'import nvidia.cuda_runtime, nvidia.cublas']);
    return python;
  }
  catch { /* Provision dependencies into this engine's private cache. */ }
  console.log(`Setting up the ${engine} Python environment (first launch only)…`);
  await mkdir(cacheRoot, { recursive: true });
  try { await run(pythonCommand.command, [...pythonCommand.prefix, '-m', 'venv', environment], { setup: true }); }
  catch (error) { throw new Error(`Could not create the ${engine} Python environment. Install Python with venv support. ${error instanceof Error ? error.message : ''}`); }
  if (crispCuda) {
    // CrispASR's CUDA release links against CUDA 12 even on hosts whose system toolkit is newer.
    // Bundle only the runtime libraries it needs; do not rely on CUDA toolkit files being installed.
    await run(python, ['-m', 'pip', 'install', 'nvidia-cuda-runtime-cu12', 'nvidia-cublas-cu12'], { setup: true });
  }
  await run(python, ['-c', moduleCheck]);
  return python;
}

async function crispCudaLibraryPath(python) {
  if (process.platform !== 'linux') return process.env.LD_LIBRARY_PATH ?? '';
  try {
    const paths = await run(python, ['-c', "import glob,site,os; root=os.path.join(site.getsitepackages()[0],'nvidia'); print(':'.join(glob.glob(os.path.join(root,'*','lib'))))"]);
    return [paths, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  } catch { return process.env.LD_LIBRARY_PATH ?? ''; }
}

const CRISP_ENGINES = ['voxcpm2'];

async function findExecutable(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) { const found = await findExecutable(path); if (found) return found; }
    else if (entry.name === (process.platform === 'win32' ? 'crispasr.exe' : 'crispasr')) return path;
  }
}

async function crispasrBinary() {
  if (process.env.WORLD_PLAYER_CRISPASR_BINARY) return process.env.WORLD_PLAYER_CRISPASR_BINARY;
  const cacheRoot = join(cacheDirectory(), 'crispasr');
  const extractionRoot = join(cacheRoot, 'release');
  try { await access(extractionRoot); const cached = await findExecutable(extractionRoot); if (cached) return cached; } catch { /* provision from official release */ }
  let linuxAsset = 'crispasr-linux-x86_64.tar.gz';
  if (process.platform === 'linux' && process.arch === 'x64') {
    try { await run('nvidia-smi', ['-L']); linuxAsset = 'crispasr-linux-x86_64-cuda.tar.gz'; }
    catch { try { await run('rocm-smi', ['--showproductname']); linuxAsset = 'crispasr-linux-x86_64-hip.tar.gz'; }
      catch { try { await run('vulkaninfo', ['--summary']); linuxAsset = 'crispasr-linux-x86_64-vulkan.tar.gz'; } catch { /* CPU-only release remains functional. */ } } }
  }
  const platformAsset = process.platform === 'linux' && process.arch === 'x64'
    ? linuxAsset
    : process.platform === 'darwin' && process.arch === 'arm64' ? 'crispasr-macos.tar.gz'
      : process.platform === 'win32' && process.arch === 'x64' ? 'crispasr-windows-x86_64-cuda.zip' : '';
  if (!platformAsset) throw new Error(`CrispASR does not publish an automatic package for ${process.platform}/${process.arch}. Set WORLD_PLAYER_CRISPASR_BINARY to a compatible CrispASR executable.`);
  await mkdir(cacheRoot, { recursive: true });
  const archive = join(cacheRoot, platformAsset);
  console.log(`Checking official CrispASR release and license notices: ${platformAsset}`);
  const releaseResponse = await fetch('https://api.github.com/repos/CrispStrobe/CrispASR/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!releaseResponse.ok) throw new Error(`Could not query the official CrispASR release metadata (HTTP ${releaseResponse.status}).`);
  const release = await releaseResponse.json();
  const releaseTag = String(release.tag_name ?? '');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(releaseTag)) throw new Error('The CrispASR release metadata contained an invalid version tag.');
  const asset = release.assets?.find(item => item.name === platformAsset);
  const digestMatch = /^sha256:([a-f0-9]{64})$/i.exec(asset?.digest ?? '');
  if (!asset?.browser_download_url || !digestMatch) throw new Error(`CrispASR release ${releaseTag} does not publish a SHA-256 digest for ${platformAsset}; refusing an unverifiable download.`);
  console.log(`Downloading verified CrispASR ${releaseTag}: ${platformAsset}`);
  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Could not download the official CrispASR runtime package (HTTP ${response.status}).`);
  const chunks = [];
  let downloadedBytes = 0;
  const maxArchiveBytes = 512 * 1024 * 1024;
  const digest = createHash('sha256');
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    downloadedBytes += buffer.length;
    if (downloadedBytes > maxArchiveBytes) throw new Error('The CrispASR runtime archive exceeded the 512 MiB safety limit.');
    digest.update(buffer);
    chunks.push(buffer);
  }
  const actualDigest = digest.digest('hex');
  if (actualDigest !== digestMatch[1].toLowerCase()) throw new Error('The downloaded CrispASR runtime failed its published SHA-256 digest check.');
  const bytes = Buffer.concat(chunks, downloadedBytes);

  const noticesDirectory = join(cacheRoot, 'notices', releaseTag);
  await mkdir(noticesDirectory, { recursive: true });
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
    const notice = await fetch(`https://raw.githubusercontent.com/CrispStrobe/CrispASR/${encodeURIComponent(releaseTag)}/${file}`, { signal: AbortSignal.timeout(30_000) });
    if (!notice.ok) throw new Error(`Could not fetch the CrispASR ${file} for ${releaseTag} (HTTP ${notice.status}); retry once the license notices are available.`);
    await writeFile(join(noticesDirectory, file), Buffer.from(await notice.arrayBuffer()));
  }
  await writeFile(archive, bytes);
  console.log(`CrispASR SHA-256 verified; matching license notices saved in ${noticesDirectory}.`);
  console.log(`Extracting CrispASR runtime package (${(bytes.length / 1048576).toFixed(0)} MB)…`);
  await mkdir(extractionRoot, { recursive: true });
  if (platformAsset.endsWith('.zip')) await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${extractionRoot.replaceAll("'", "''")}' -Force`], { setup: true });
  else await run('tar', ['-xzf', archive, '-C', extractionRoot], { setup: true });
  const extracted = await findExecutable(extractionRoot);
  if (!extracted) throw new Error('The downloaded CrispASR release did not contain its crispasr executable.');
  return extracted;
}

export async function ensureTtsWorker(endpoint, engine = 'voxcpm2') {
  if (!CRISP_ENGINES.includes(engine)) throw new Error(`Unsupported voice model: ${engine}`);
  endpoint ??= 'http://127.0.0.1:8177';
  const alreadyRunning = await readHealth(endpoint);
  if (alreadyRunning && (!worker || workerEngine === engine)) return alreadyRunning;
  if (worker && workerEngine !== engine) {
    const previousWorker = worker;
    previousWorker.kill('SIGTERM');
    worker = undefined;
    workerEngine = undefined;
    if (previousWorker.exitCode === null && previousWorker.signalCode === null) {
      await Promise.race([
        new Promise(resolveWait => previousWorker.once('exit', resolveWait)),
        new Promise(resolveWait => setTimeout(resolveWait, 30_000)),
      ]);
    }
  }
  if (startup) return startup;
  startup = (async () => {
    const parsed = new URL(endpoint);
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)) {
      throw new Error('Automatic startup is only available for a local voice service.');
    }
    lastOutput = '';
    const executable = await pythonForWorker(engine);
    const crispasr = CRISP_ENGINES.includes(engine) ? await crispasrBinary() : '';
    const libraryPath = await crispCudaLibraryPath(executable);
    const host = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname.replace(/^\[|\]$/g, '');
    const workerScript = 'voice-tts-server.py';
    worker = spawn(executable, [resolve(projectRoot, 'tools', workerScript)], {
      cwd: projectRoot,
      env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}), WORLD_PLAYER_TTS_ENGINE: engine, WORLD_PLAYER_CRISPASR_BINARY: crispasr, QWEN_TTS_HOST: host, QWEN_TTS_PORT: parsed.port || '8177' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    workerEngine = engine;
    worker.stderr?.on('data', chunk => { lastOutput = `${lastOutput}${chunk}`.slice(-1600); });
    worker.on('error', error => { lastOutput = `${lastOutput}\n${error.message}`.slice(-1600); });
    worker.on('exit', () => { worker = undefined; });
    const child = worker;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Could not start the local ${engine} voice service. ${lastOutput.trim() || 'Python exited before the service became ready.'}`);
      const health = await readHealth(endpoint);
      if (health) return health;
      await new Promise(resolveWait => setTimeout(resolveWait, 300));
    }
    child.kill('SIGTERM');
    throw new Error(`The local ${engine} voice service did not become ready. ${lastOutput.trim() || 'Startup timed out.'}`);
  })().finally(() => { startup = undefined; });
  return startup;
}

export function stopTtsWorker() {
  if (setupProcess && setupProcess.exitCode === null && setupProcess.signalCode === null) setupProcess.kill('SIGTERM');
  if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill('SIGTERM');
  worker = undefined;
  workerEngine = undefined;
}
