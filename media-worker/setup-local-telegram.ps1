$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Get-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) { return $null }
  $line = Get-Content $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -Last 1
  if (-not $line) { return $null }
  return (($line -split "=", 2)[1]).Trim()
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is not installed. Install/open Docker Desktop, restart Windows once, then run this command again."
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $dockerDesktop) {
    Write-Host "Starting Docker Desktop..."
    Start-Process $dockerDesktop
  }
  $engineReady = $false
  for ($attempt = 1; $attempt -le 60; $attempt += 1) {
    Start-Sleep -Seconds 2
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
      $engineReady = $true
      break
    }
  }
  if (-not $engineReady) {
    throw "Docker engine did not become ready within 120 seconds. Open Docker Desktop and wait until it says Engine running, then rerun this script."
  }
}

$localApi = Join-Path $PSScriptRoot "telegram-local-api"
$localEnv = Join-Path $localApi ".env"
if (-not (Test-Path $localEnv)) {
  Copy-Item (Join-Path $localApi ".env.example") $localEnv
}

$apiId = Get-EnvValue $localEnv "TELEGRAM_API_ID"
$apiHash = Get-EnvValue $localEnv "TELEGRAM_API_HASH"
if (-not $apiId -or $apiId -notmatch "^\d+$" -or $apiId -eq "12345678") {
  $apiId = (Read-Host "Enter the Telegram api_id from my.telegram.org/apps").Trim()
}
if (-not $apiHash -or $apiHash -notmatch "^[a-fA-F0-9]{32}$") {
  $apiHash = (Read-Host "Enter the Telegram api_hash from my.telegram.org/apps").Trim()
}
if ($apiId -notmatch "^\d+$" -or $apiHash -notmatch "^[a-fA-F0-9]{32}$") {
  throw "Invalid Telegram api_id or api_hash. api_id must contain digits and api_hash must contain 32 hexadecimal characters."
}
Write-Utf8NoBom $localEnv "TELEGRAM_API_ID=$apiId`r`nTELEGRAM_API_HASH=$apiHash`r`n"

$workerEnv = Join-Path $PSScriptRoot ".env"
$botToken = Get-EnvValue $workerEnv "TELEGRAM_BOT_TOKEN"
if (-not $botToken -or $botToken -notmatch "^\d+:[A-Za-z0-9_-]+$") {
  throw "TELEGRAM_BOT_TOKEN is missing or invalid in media-worker/.env."
}

Write-Host "Starting Telegram Local Bot API..."
Push-Location $localApi
try {
  & docker compose pull
  if ($LASTEXITCODE -ne 0) { throw "Docker could not download the Telegram Local Bot API image." }
  & docker compose up -d
  if ($LASTEXITCODE -ne 0) { throw "Docker could not start the Telegram Local Bot API container." }
} finally {
  Pop-Location
}

$healthUrl = "http://127.0.0.1:8081/bot$botToken/getMe"
$localReady = $false
for ($attempt = 1; $attempt -le 60; $attempt += 1) {
  try {
    $health = Invoke-RestMethod -UseBasicParsing -Uri $healthUrl -TimeoutSec 5
    if ($health.ok -eq $true) {
      $localReady = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $localReady) {
  Write-Host "Telegram Local Bot API did not pass getMe health verification. Recent container logs:"
  & docker logs --tail 80 easy-education-telegram-bot-api
  throw "Local Telegram transport is not ready. The worker configuration was not changed."
}

$content = Get-Content $workerEnv -Raw
if ($content -match "(?m)^TELEGRAM_API_BASE_URL=") {
  $content = $content -replace "(?m)^TELEGRAM_API_BASE_URL=.*$", "TELEGRAM_API_BASE_URL=http://127.0.0.1:8081"
} else {
  $content += "`r`nTELEGRAM_API_BASE_URL=http://127.0.0.1:8081`r`n"
}
Write-Utf8NoBom $workerEnv $content

Write-Host "Telegram Local Bot API health check passed."
Write-Host "Worker transport: http://127.0.0.1:8081"
Write-Host "Restart start-worker.ps1 now."
