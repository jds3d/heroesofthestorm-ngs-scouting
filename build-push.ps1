$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Test-Path ".env.local")) {
    throw ".env.local was not found in $scriptDir. Create it first or point docker-compose to the correct env file."
}

Write-Host "Stopping any existing containers..."
docker compose --env-file .env.local down --remove-orphans

Write-Host "Rebuilding from current source..."
docker compose --env-file .env.local up -d --build --force-recreate

Write-Host "Done. The app should now be running on http://localhost:3000"
