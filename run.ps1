$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (Test-Path '.tools\node') { $env:PATH = (Join-Path $PSScriptRoot '.tools\node') + ';' + $env:PATH }
if (Test-Path '.tools\pnpm\node_modules\.bin') { $env:PATH = (Join-Path $PSScriptRoot '.tools\pnpm\node_modules\.bin') + ';' + $env:PATH }

$esc = [char]27
$yellow = "$esc[38;2;253;240;119m"
$reset = "$esc[0m"
if (-not $env:NO_COLOR -and -not [Console]::IsOutputRedirected -and (Test-Path 'ascii.txt') -and (Test-Path 'bigtext.txt')) {
  Write-Host ($yellow + (Get-Content 'ascii.txt' -Raw -Encoding UTF8) + (Get-Content 'bigtext.txt' -Raw -Encoding UTF8) + $reset)
} else {
  Write-Host 'DanmuTalk · local-first character chats'
}

$port = if ($env:PORT) { $env:PORT } else { '5173' }
if ($args -contains '--dev') {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue) -or -not (Test-Path 'node_modules')) {
    throw 'pnpm and project dependencies are required for --dev. Run install.ps1 first.'
  }
  & pnpm --filter @world-player/desktop exec vite --port $port
  exit $LASTEXITCODE
}
if (-not (Test-Path 'apps/desktop/dist/index.html')) {
  throw 'Built app not found. Run install.ps1 to prepare DanmuTalk before launching.'
}
node tools/serve.mjs --port $port
