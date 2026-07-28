# Build + sync open-delegate into ~/.cursor/plugins/local/open-delegate.
# Real directory copy - Cursor on Windows does not reliably discover SYMLINKD
# under plugins/local. Re-run this after every change (rebuilds first).
$ErrorActionPreference = "Stop"
$Src = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Dst = Join-Path $env:USERPROFILE ".cursor\plugins\local\open-delegate"

Write-Host "Building open-delegate ($Src)..."
Push-Location $Src
try {
	npm install
	if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
	npm run build
	if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} finally {
	Pop-Location
}

function Sync-Tree {
	param([string]$Rel)
	$from = Join-Path $Src $Rel
	$to = Join-Path $Dst $Rel
	if (-not (Test-Path $from)) { return }
	$parent = Split-Path $to -Parent
	New-Item -ItemType Directory -Force -Path $parent | Out-Null
	if (Test-Path $to) { Remove-Item -Recurse -Force $to }
	Copy-Item -Recurse -Force $from $to
}

New-Item -ItemType Directory -Force -Path $Dst | Out-Null

foreach ($rel in @("dist", "node_modules", "skills", ".cursor-plugin")) {
	Write-Host "Syncing $rel..."
	Sync-Tree $rel
}

foreach ($f in @("mcp.json", "package.json", "README.md")) {
	$from = Join-Path $Src $f
	if (Test-Path $from) {
		Copy-Item -Force $from (Join-Path $Dst $f)
	}
}

# Mirror the skill into the global skills root (same pattern as creative-corpus/creative-operator)
$GlobalSkills = Join-Path $env:USERPROFILE ".cursor\skills"
New-Item -ItemType Directory -Force -Path $GlobalSkills | Out-Null
$SkillSrc = Join-Path $Src "skills\ode-delegate"
if (Test-Path $SkillSrc) {
	$destSkill = Join-Path $GlobalSkills "ode-delegate"
	if (Test-Path $destSkill) { Remove-Item -Recurse -Force $destSkill }
	Copy-Item -Recurse -Force $SkillSrc $destSkill
}

Write-Host ""
Write-Host "Synced plugin payload -> $Dst"
Write-Host "Mirrored skill -> $GlobalSkills\ode-delegate"
Write-Host "Next: Cursor -> Ctrl+Shift+P -> 'Developer: Reload Window'"
Write-Host "Then: Customize -> MCP Tools should list 'open-delegate' with 6 tools."
