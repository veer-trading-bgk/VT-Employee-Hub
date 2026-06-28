# Builds deployment.zip for the vt-employee-bot-api Lambda function.
# Includes: src/, package.json, production-only node_modules.
# Excludes: devDependencies, aws-sdk browser bundles, type defs, source maps, docs.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$zipPath = Join-Path $root "deployment.zip"

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$staging = Join-Path $root ".lambda-staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

# 1. Copy application source
Copy-Item (Join-Path $root "src")               (Join-Path $staging "src") -Recurse
Copy-Item (Join-Path $root "package.json")      $staging
Copy-Item (Join-Path $root "package-lock.json") $staging

# 2. Install production-only dependencies inside staging
Write-Host "Installing production dependencies..."
Push-Location $staging
npm ci --omit=dev --silent
Pop-Location

# 3. Remove aws-sdk browser bundle (not needed in Lambda)
$awsSdkDist = Join-Path $staging "node_modules\aws-sdk\dist"
if (Test-Path $awsSdkDist) {
    Remove-Item $awsSdkDist -Recurse -Force
    Write-Host "Removed aws-sdk/dist"
}

# 4. Remove .bin shell scripts (not usable inside Lambda)
$binDir = Join-Path $staging "node_modules\.bin"
if (Test-Path $binDir) { Remove-Item $binDir -Recurse -Force }

# 5. Remove TypeScript type definitions and source maps
Get-ChildItem -Path $staging -Recurse -Include "*.d.ts","*.d.ts.map","*.js.map" | Remove-Item -Force

# 6. Remove documentation files
Get-ChildItem -Path $staging -Recurse -Include "README*","readme*","CHANGELOG*","CHANGES*","HISTORY*","LICENSE*","LICENCE*","NOTICE*","*.md","*.txt" | Remove-Item -Force -Recurse

# 7. Check unzipped size before compressing (Lambda limit: 262 MB)
$stagingBytes = (Get-ChildItem -Path $staging -Recurse -File | Measure-Object -Property Length -Sum).Sum
$stagingMB = [math]::Round($stagingBytes / 1MB, 1)
Write-Host "Unzipped size: $stagingMB MB  (limit: 250 MB)"

$limitBytes = 250 * 1024 * 1024
if ($stagingBytes -gt $limitBytes) {
    Write-Error "Staging exceeds 250 MB - zip will be rejected by Lambda. Aborting."
    Remove-Item $staging -Recurse -Force
    exit 1
}

# 8. Compress and clean up
Compress-Archive -Path "$staging\*" -DestinationPath $zipPath -Force
Remove-Item $staging -Recurse -Force

Write-Host "Built $zipPath"
Get-Item $zipPath | Select-Object Name, @{N='SizeMB';E={[math]::Round($_.Length/1MB,2)}}
