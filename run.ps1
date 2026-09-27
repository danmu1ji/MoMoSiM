$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (Test-Path '.tools\node') { $env:PATH = (Join-Path $PSScriptRoot '.tools\node') + ';' + $env:PATH }
if (Test-Path '.tools\pnpm\node_modules\.bin') { $env:PATH = (Join-Path $PSScriptRoot '.tools\pnpm\node_modules\.bin') + ';' + $env:PATH }

$esc = [char]27
$pink = "$esc[38;5;213m"
$reset = "$esc[0m"
if (-not $env:NO_COLOR -and -not [Console]::IsOutputRedirected -and (Test-Path 'ascii.txt') -and (Test-Path 'bigtext.txt')) {
  Write-Host ($pink + (Get-Content 'ascii.txt' -Raw) + (Get-Content 'bigtext.txt' -Raw) + $reset)
} else {
  Write-Host 'MoMoSiM · local-first character chats'
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22+ (includes Corepack), then run corepack enable.' }
  corepack enable
}
if (-not (Test-Path 'node_modules')) { pnpm install }
pnpm build
pnpm --filter @world-player/desktop build
$port = if ($env:PORT) { $env:PORT } else { '5173' }
node tools/serve.mjs --port $port
