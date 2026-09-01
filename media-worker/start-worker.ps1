$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path ".env")) { throw "Copy .env.example to .env and configure it first." }

# Keep the executable worker files current without touching local secrets or queued media.
# A failed/invalid download leaves the last working files in place.
$rawBase = "https://raw.githubusercontent.com/easyeducation556644-ux/easy-education/main/media-worker"
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$updates = @(
  @{ Name = "worker.mjs"; Temp = "worker.update.mjs" },
  @{ Name = "youtube-android-resolver.mjs"; Temp = "youtube-android-resolver.update.mjs" }
)

try {
  foreach ($update in $updates) {
    Invoke-WebRequest `
      -UseBasicParsing `
      -TimeoutSec 30 `
      -Headers @{ "Cache-Control" = "no-cache" } `
      -Uri "$rawBase/$($update.Name)?v=$stamp" `
      -OutFile $update.Temp
    if ((Get-Item $update.Temp).Length -lt 500) {
      throw "Downloaded $($update.Name) is unexpectedly small."
    }
    node --check $update.Temp
    if ($LASTEXITCODE -ne 0) { throw "Downloaded $($update.Name) failed JavaScript validation." }
  }
  foreach ($update in $updates) {
    Move-Item -Force $update.Temp $update.Name
  }
  Write-Host "Media worker files are up to date."
} catch {
  foreach ($update in $updates) { Remove-Item -Force $update.Temp -ErrorAction SilentlyContinue }
  Write-Warning "Auto-update skipped; using the last working worker files. $($_.Exception.Message)"
}

node worker.mjs
