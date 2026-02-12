# Start Cloudflare Quick Tunnel
Write-Host "Starting Cloudflare Quick Tunnel..." -ForegroundColor Green
Write-Host "The tunnel URL will appear below. Copy it to use in the app." -ForegroundColor Yellow
Write-Host ""

& ".\cloudflared.exe" tunnel --url http://localhost:3001
