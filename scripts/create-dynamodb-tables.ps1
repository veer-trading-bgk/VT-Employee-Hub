# Creates DynamoDB tables needed for Phases 7-9 (badges, points).
# Tables: employees, business_metrics, audit_logs already exist.
# This script is idempotent — safe to re-run.

$region = "ap-south-1"

function Create-Table($name, $pk, $sk = $null) {
    $exists = aws dynamodb describe-table --table-name $name --region $region 2>$null
    if ($?) {
        Write-Host "  [skip] $name already exists"
        return
    }

    if ($sk) {
        aws dynamodb create-table `
            --table-name $name `
            --attribute-definitions `
                AttributeName=$pk,AttributeType=S `
                AttributeName=$sk,AttributeType=S `
            --key-schema `
                AttributeName=$pk,KeyType=HASH `
                AttributeName=$sk,KeyType=RANGE `
            --billing-mode PAY_PER_REQUEST `
            --region $region | Out-Null
    } else {
        aws dynamodb create-table `
            --table-name $name `
            --attribute-definitions AttributeName=$pk,AttributeType=S `
            --key-schema AttributeName=$pk,KeyType=HASH `
            --billing-mode PAY_PER_REQUEST `
            --region $region | Out-Null
    }
    Write-Host "  [created] $name"
}

Write-Host "Creating DynamoDB tables..."
Create-Table "vt-badges" "PK" "SK"
Write-Host "Done."
