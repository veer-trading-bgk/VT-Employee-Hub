# Creates the ws_connections DynamoDB table with TTL + companyIdIndex GSI.
# Run once before deploying the WebSocket Lambda.
#
# Usage:
#   .\scripts\create-ws-table.ps1
#   .\scripts\create-ws-table.ps1 -Region eu-west-1 -TableName ws_connections_dev

param(
  [string]$Region    = "ap-south-1",
  [string]$TableName = "ws_connections"
)

$ErrorActionPreference = "Stop"

Write-Host "Creating DynamoDB table: $TableName in $Region ..."

aws dynamodb create-table `
  --region $Region `
  --table-name $TableName `
  --billing-mode PAY_PER_REQUEST `
  --attribute-definitions `
    AttributeName=connectionId,AttributeType=S `
    AttributeName=companyId,AttributeType=S `
  --key-schema `
    AttributeName=connectionId,KeyType=HASH `
  --global-secondary-indexes '[
    {
      "IndexName": "companyIdIndex",
      "KeySchema": [
        {"AttributeName": "companyId", "KeyType": "HASH"},
        {"AttributeName": "connectionId", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }
  ]'

if ($LASTEXITCODE -ne 0) {
  Write-Error "create-table failed (exit $LASTEXITCODE). Does the table already exist?"
  exit 1
}

Write-Host "Waiting for table to become ACTIVE ..."
aws dynamodb wait table-exists --region $Region --table-name $TableName

Write-Host "Enabling TTL on attribute 'ttl' ..."
aws dynamodb update-time-to-live `
  --region $Region `
  --table-name $TableName `
  --time-to-live-specification "Enabled=true,AttributeName=ttl"

Write-Host ""
Write-Host "Done. Table '$TableName' is ready."
Write-Host "Next: set WS_CONNECTIONS_TABLE=$TableName in Lambda env vars."
