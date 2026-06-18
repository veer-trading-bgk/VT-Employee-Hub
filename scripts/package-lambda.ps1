# Builds deployment.zip for the vt-employee-bot-api Lambda function.
# Includes only what the Lambda runtime needs: src/, server-side node_modules,
# package.json. Excludes the dashboard, dev tooling, logs, and local-only files.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$zipPath = Join-Path $root "deployment.zip"

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$staging = Join-Path $root ".lambda-staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

Copy-Item (Join-Path $root "src") (Join-Path $staging "src") -Recurse
Copy-Item (Join-Path $root "package.json") $staging
Copy-Item (Join-Path $root "node_modules") (Join-Path $staging "node_modules") -Recurse

Compress-Archive -Path "$staging\*" -DestinationPath $zipPath -Force
Remove-Item $staging -Recurse -Force

Write-Host "Built $zipPath"
Get-Item $zipPath | Select-Object Name, @{N='SizeMB';E={[math]::Round($_.Length/1MB,2)}}
