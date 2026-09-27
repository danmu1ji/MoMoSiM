$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repository = if ($env:MOMOSIM_GITHUB_REPOSITORY) { $env:MOMOSIM_GITHUB_REPOSITORY } else { 'danmu1ji/danmutalk' }
$Target = if ($env:MOMOSIM_DIR) { $env:MOMOSIM_DIR } else { Join-Path $HOME 'DanmuTalk' }
$Marker = Join-Path $Target '.momosi-install'
if ((Test-Path $Target) -and -not (Test-Path $Marker)) {
  throw "Refusing to overwrite '$Target'. Set MOMOSIM_DIR to a new folder."
}
$Updating = Test-Path $Marker
$Temp = Join-Path ([IO.Path]::GetTempPath()) ("momosi-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temp | Out-Null
try {
  $SourceZip = Join-Path $Temp 'source.zip'
  $SourceUrl = "https://github.com/$Repository/archive/refs/heads/main.zip"
  Write-Host 'Downloading DanmuTalk source from GitHub...'
  Invoke-WebRequest -Uri $SourceUrl -OutFile $SourceZip
  Expand-Archive -LiteralPath $SourceZip -DestinationPath $Temp
  $SourceRoot = Get-ChildItem -LiteralPath $Temp -Directory | Where-Object Name -Like 'momo-sim-*' | Select-Object -First 1
  if (-not $SourceRoot) { throw 'The GitHub source archive did not contain momo-sim.' }
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  & robocopy $SourceRoot.FullName $Target /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Could not copy the source files (robocopy exit $LASTEXITCODE)." }
  $LASTEXITCODE = 0
  New-Item -ItemType Directory -Force -Path (Join-Path $Target 'worlds') | Out-Null
  Set-Content -LiteralPath $Marker -Value "repository=$Repository"

  $Tools = Join-Path $Target '.tools'
  $NodeMajor = 0
  if (Get-Command node -ErrorAction SilentlyContinue) {
    try { $NodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0]) } catch { $NodeMajor = 0 }
  }
  if ($NodeMajor -lt 22) {
    $Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $Base = 'https://nodejs.org/download/release/latest-v22.x'
    $SumsFile = Join-Path $Temp 'SHASUMS256.txt'
    Invoke-WebRequest -Uri "$Base/SHASUMS256.txt" -OutFile $SumsFile
    $SumText = Get-Content -LiteralPath $SumsFile -Raw
    $Match = [regex]::Match($SumText, "(?m)^([a-f0-9]{64})\s+(node-v22\.[0-9.]+-win-$Arch\.zip)$")
    if (-not $Match.Success) { throw "No Node.js 22 Windows archive for $Arch." }
    $NodeArchive = $Match.Groups[2].Value
    $NodeZip = Join-Path $Temp $NodeArchive
    Invoke-WebRequest -Uri "$Base/$NodeArchive" -OutFile $NodeZip
    $ActualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $NodeZip).Hash.ToLowerInvariant()
    if ($ActualHash -ne $Match.Groups[1].Value) { throw 'Node.js checksum verification failed.' }
    $NodeExtract = Join-Path $Temp 'node'
    Expand-Archive -LiteralPath $NodeZip -DestinationPath $NodeExtract
    $NodeRoot = Get-ChildItem -LiteralPath $NodeExtract -Directory | Select-Object -First 1
    $NodePath = Join-Path $Tools 'node'
    New-Item -ItemType Directory -Force -Path $NodePath | Out-Null
    & robocopy $NodeRoot.FullName $NodePath /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Could not install Node.js (robocopy exit $LASTEXITCODE)." }
    $LASTEXITCODE = 0
    $env:PATH = "$NodePath;$env:PATH"
  }

  $PnpmVersion = ''
  if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) {
    try { $PnpmVersion = (& pnpm.cmd --version).Trim() } catch { $PnpmVersion = '' }
  }
  if (-not $PnpmVersion.StartsWith('9.')) {
    $PnpmHome = Join-Path $Tools 'pnpm'
    & npm.cmd install --prefix $PnpmHome pnpm@9.15.0
    if ($LASTEXITCODE -ne 0) { throw 'Could not install pnpm.' }
    $env:PATH = "$(Join-Path $PnpmHome 'node_modules\.bin');$env:PATH"
  }
  Set-Location $Target
  & pnpm.cmd install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  & pnpm.cmd build
  if ($LASTEXITCODE -ne 0) { throw 'DanmuTalk build failed.' }
  & pnpm.cmd --filter @world-player/desktop build
  if ($LASTEXITCODE -ne 0) { throw 'Desktop player build failed.' }
  if ($Updating) { Write-Host "DanmuTalk updated in $Target" } else { Write-Host "DanmuTalk installed in $Target" }
  Write-Host "Put your .😭 world package in $Target\worlds, then open it in DanmuTalk or drag it onto the app window."
  Write-Host "Launch with: $Target\run.ps1"
} finally {
  Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue
}
