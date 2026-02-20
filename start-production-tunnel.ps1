# Start Production Tunnel for app.rentflows.work
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Starting Production Tunnel" -ForegroundColor Cyan
Write-Host "  Domain: app.rentflows.work" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check if tunnel config exists
if (-not (Test-Path "cloudflare-tunnel-config.yml")) {
    Write-Host "ERROR: cloudflare-tunnel-config.yml not found!" -ForegroundColor Red
    Write-Host "Please create and configure the file first." -ForegroundColor Yellow
    Write-Host "See PRODUCTION-DOMAIN-SETUP.md for instructions." -ForegroundColor Yellow
    exit 1
}

# Check if cloudflared.exe exists
if (-not (Test-Path "cloudflared.exe")) {
    Write-Host "ERROR: cloudflared.exe not found!" -ForegroundColor Red
    Write-Host "Please download cloudflared.exe to this directory." -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting Cloudflare Tunnel..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Start tunnel with config
try {
    .\cloudflared.exe tunnel --config cloudflare-tunnel-config.yml run
} catch {
    Write-Host ""
    Write-Host "Tunnel error: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Tunnel stopped" -ForegroundColor Yellow
