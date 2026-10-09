$body = @{
    cpu_temp = 45.2
    ram_usage = 38.5
    disk_usage = 20.1
    printer_status = "READY"
    agent_version = "1.0.0"
} | ConvertTo-Json

$headers = @{
    "x-kiosk-id" = "GITAM-SPK-001"
    "x-device-token" = "gitam_spk_001_secure_device_secret_2026"
    "Content-Type" = "application/json"
}

Write-Host "=== Testing /api/kiosk/heartbeat ===" -ForegroundColor Cyan
$response = Invoke-RestMethod -Uri "http://localhost:3000/api/kiosk/heartbeat" -Method POST -Headers $headers -Body $body
$response | ConvertTo-Json

Write-Host "`n=== Testing /api/kiosk/poll-jobs ===" -ForegroundColor Cyan
$pollBody = @{ kiosk_id = "GITAM-SPK-001" } | ConvertTo-Json
$pollResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/kiosk/poll-jobs" -Method POST -Headers @{"x-kiosk-id" = "GITAM-SPK-001"; "Content-Type" = "application/json"} -Body $pollBody
$pollResponse | ConvertTo-Json

Write-Host "`n=== Testing /api/admin/data ===" -ForegroundColor Cyan
$adminDataResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/data" -Method GET -Headers @{"x-admin-token" = "gitam_admin_secret_2026"}
$adminDataResponse | ConvertTo-Json -Depth 2

Write-Host "`n=== Testing /api/admin/simulate (heartbeat) ===" -ForegroundColor Cyan
$simBody = @{ action = "simulate_heartbeat"; kiosk_id = "GITAM-SPK-001" } | ConvertTo-Json
$simResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/simulate" -Method POST -Headers @{"Content-Type" = "application/json"} -Body $simBody
$simResponse | ConvertTo-Json

Write-Host "`nAll tests completed!" -ForegroundColor Green
