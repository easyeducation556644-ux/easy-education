$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Install Docker Desktop manually, then run this script again."
  }
  Write-Host "Installing Docker Desktop. Windows may require a restart after installation."
  winget install --id Docker.DockerDesktop --exact --accept-package-agreements --accept-source-agreements
  throw "Docker Desktop was installed. Restart Windows, open Docker Desktop, then run this script again."
}

$localApi = Join-Path $PSScriptRoot "telegram-local-api"
Set-Location $localApi
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  throw "Created telegram-local-api/.env. Add TELEGRAM_API_ID and TELEGRAM_API_HASH, then run this script again."
}

docker compose up -d
$workerEnv = Join-Path (Split-Path $localApi -Parent) ".env"
if (Test-Path $workerEnv) {
  $content = Get-Content $workerEnv -Raw
  if ($content -match "(?m)^TELEGRAM_API_BASE_URL=") {
    $content = $content -replace "(?m)^TELEGRAM_API_BASE_URL=.*$", "TELEGRAM_API_BASE_URL=http://127.0.0.1:8081"
  } else {
    $content += "`r`nTELEGRAM_API_BASE_URL=http://127.0.0.1:8081`r`n"
  }
  Set-Content $workerEnv $content -NoNewline
}

Write-Host "Telegram Local Bot API is running at http://127.0.0.1:8081"
Write-Host "The worker is now configured for uploads up to 2 GB."
