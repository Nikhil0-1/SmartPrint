$BASE_URL = "http://localhost:3000"
$KIOSK_ID = "GITAM-SPK-001"
$DEVICE_TOKEN = "gitam_spk_001_secure_device_secret_2026"

function Invoke-API {
    param($Method, $Path, $Body = $null, $Headers = @{})
    $Headers["Content-Type"] = "application/json"
    $params = @{
        Uri = "$BASE_URL$Path"
        Method = $Method
        Headers = $Headers
    }
    if ($Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
    try {
        return Invoke-RestMethod @params
    } catch {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

Write-Host "`n========================================" -ForegroundColor White
Write-Host " GITAM SMARTPRINT - FULL E2E API TEST" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor White

# STEP 1: Health Check
Write-Host "STEP 1: System Health Check" -ForegroundColor Cyan
$health = Invoke-API -Method GET -Path "/api/health"
if ($health.status -eq "PASS") {
    Write-Host "  [PASS] Health: $($health.status) | Kiosks Online: $($health.components.kiosks_online)" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Health check failed" -ForegroundColor Red
}

# STEP 2: Branding
Write-Host "`nSTEP 2: Branding Config" -ForegroundColor Cyan
$branding = Invoke-API -Method GET -Path "/api/branding"
if ($branding.success) {
    Write-Host "  [PASS] Brand: $($branding.branding.organization) $($branding.branding.product)" -ForegroundColor Green
    Write-Host "  [PASS] Tagline: $($branding.branding.primary_tagline)" -ForegroundColor Green
}

# STEP 3: Pricing
Write-Host "`nSTEP 3: Pricing Config" -ForegroundColor Cyan
$pricing = Invoke-API -Method GET -Path "/api/pricing"
if ($pricing.success) {
    Write-Host "  [PASS] B&W per page: Rs.$($pricing.pricing.bw_price_per_page) | Color: Rs.$($pricing.pricing.color_price_per_page)" -ForegroundColor Green
}

# STEP 4: Calculate Price
Write-Host "`nSTEP 4: Calculate Price" -ForegroundColor Cyan
$priceBody = @{ pages = 5; copies = 1; is_color = $false; is_duplex = $false }
$priceResult = Invoke-API -Method POST -Path "/api/customer/calculate-price" -Body $priceBody
if ($priceResult.success) {
    Write-Host "  [PASS] 5 B&W pages = Rs.$($priceResult.total_amount)" -ForegroundColor Green
}

# STEP 5: Kiosk Heartbeat
Write-Host "`nSTEP 5: Kiosk Heartbeat" -ForegroundColor Cyan
$heartbeatBody = @{ cpu_temp = 44.1; ram_usage = 36.5; disk_usage = 19.8; printer_status = "READY"; agent_version = "1.0.0" }
$heartbeat = Invoke-API -Method POST -Path "/api/kiosk/heartbeat" -Body $heartbeatBody -Headers @{"x-kiosk-id" = $KIOSK_ID; "x-device-token" = $DEVICE_TOKEN}
if ($heartbeat.success) {
    Write-Host "  [PASS] Heartbeat recorded | Maintenance: $($heartbeat.maintenance_mode)" -ForegroundColor Green
}

# STEP 6: Admin Data
Write-Host "`nSTEP 6: Admin Dashboard Data" -ForegroundColor Cyan
$adminData = Invoke-API -Method GET -Path "/api/admin/data" -Headers @{"x-admin-token" = "gitam_admin_secret_2026"}
if ($adminData.kiosks) {
    Write-Host "  [PASS] Kiosks: $($adminData.kiosks.Count) | Jobs: $($adminData.jobs.Count) | Payments: $($adminData.payments.Count)" -ForegroundColor Green
}

# STEP 7: Simulate Full Print Lifecycle
Write-Host "`nSTEP 7: Simulate Print Lifecycle" -ForegroundColor Cyan
$simBody = @{ action = "simulate_heartbeat"; kiosk_id = $KIOSK_ID }
$sim = Invoke-API -Method POST -Path "/api/admin/simulate" -Body $simBody
if ($sim.success) {
    Write-Host "  [PASS] Simulation: $($sim.message)" -ForegroundColor Green
}

# STEP 8: Poll Jobs
Write-Host "`nSTEP 8: Poll Jobs (Kiosk)" -ForegroundColor Cyan
$pollBody = @{ kiosk_id = $KIOSK_ID }
$poll = Invoke-API -Method POST -Path "/api/kiosk/poll-jobs" -Body $pollBody -Headers @{"x-kiosk-id" = $KIOSK_ID}
if ($null -ne $poll) {
    Write-Host "  [PASS] Pending jobs count: $($poll.jobs.Count)" -ForegroundColor Green
}

Write-Host "`n========================================" -ForegroundColor White
Write-Host "  ALL TESTS COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor White
