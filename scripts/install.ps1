# Thin wrapper: install deps, build, register this checkout as a Cursor local plugin.
# Cross-platform registration logic lives in register-local-plugin.mjs.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "==> npm install"
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> npm run build"
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> npm run register:local"
npm run register:local
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Done. In Cursor: Developer → Reload Window"
Write-Host "Then Customize → MCP Tools should list open-delegate."
