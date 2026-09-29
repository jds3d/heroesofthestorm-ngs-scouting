$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$composeFile = Join-Path $scriptDir "docker-compose.yml"
if (-not (Test-Path $composeFile)) {
    throw "docker-compose.yml was not found in $scriptDir."
}

$envFile = Join-Path $scriptDir ".env.local"
if (-not (Test-Path $envFile)) {
    $fallback = Join-Path $scriptDir ".env"
    if (-not (Test-Path $fallback)) {
        throw ".env.local (or .env) was not found in $scriptDir. Create it before running the build."
    }
    $envFile = $fallback
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    throw "Docker is not installed or not on PATH."
}

& docker compose --env-file $envFile -f $composeFile config --quiet *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose configuration is invalid. Check docker-compose.yml and .env values."
}

Write-Host "Stopping any existing containers..."
try {
    & docker compose --env-file $envFile -f $composeFile down --remove-orphans
} catch {
    Write-Warning "docker compose down failed cleanly: $($_.Exception.Message)"
}

Write-Host "Rebuilding from current source..."
& docker compose --env-file $envFile -f $composeFile up -d --build --force-recreate --remove-orphans
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed. Check the Docker logs for the app and tunnel services."
}

Write-Host "Done. The app should now be running on http://localhost:3000"
