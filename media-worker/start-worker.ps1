$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path ".env")) { throw "Copy .env.example to .env and configure it first." }
node worker.mjs
