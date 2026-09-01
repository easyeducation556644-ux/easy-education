$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Installing Easy Education media worker dependencies..."

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "Windows Package Manager (winget) is required. Install App Installer from Microsoft Store."
}

winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
winget install --id yt-dlp.yt-dlp --exact --accept-package-agreements --accept-source-agreements
winget install --id Gyan.FFmpeg --exact --accept-package-agreements --accept-source-agreements

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env. Add AUTOMATION_SECRET and TELEGRAM_BOT_TOKEN before starting."
}

New-Item -ItemType Directory -Force -Path "work" | Out-Null
Write-Host "Installation complete. Restart PowerShell, edit .env, then run start-worker.ps1"
