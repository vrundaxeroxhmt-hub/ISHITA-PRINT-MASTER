[CmdletBinding()]
param(
    [ValidateSet('Menu', 'Start', 'Stop', 'Status', 'Open', 'Urls')]
    [string]$Action = 'Menu',
    [switch]$NoOpen,
    # Non-menu validation mode. Normal START ALL always includes ngrok.
    [switch]$LocalOnly
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$RuntimeDir = Join-Path $ProjectRoot '.dev-runtime'
$RuntimeFile = Join-Path $RuntimeDir 'runtime.json'
$LogDir = Join-Path $RuntimeDir 'logs'
$EngineRoot = 'D:\DILIP PROJECTS\TOOLS\IM_AI_ENGINE'
$NgrokDomain = 'https://chatter-frighten-quotation.ngrok-free.dev'
$NgrokDomainHost = ([uri]$NgrokDomain).Host
$MetaCallback = "$NgrokDomain/api/meta/webhook"
$PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Write-Runtime($Runtime) {
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    $temporary = "$RuntimeFile.$PID.tmp"
    $Runtime | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $RuntimeFile -Force
}

function Read-Runtime {
    if (-not (Test-Path -LiteralPath $RuntimeFile)) { return $null }
    try { return Get-Content -LiteralPath $RuntimeFile -Raw | ConvertFrom-Json }
    catch { throw "Runtime state is invalid: $RuntimeFile" }
}

function Test-PortFree([int]$Port) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    } catch { return $false }
    finally { if ($listener) { $listener.Stop() } }
}

function Select-FreePort([int]$Preferred, [System.Collections.Generic.HashSet[int]]$Reserved) {
    if (-not $Reserved.Contains($Preferred) -and (Test-PortFree $Preferred)) {
        [void]$Reserved.Add($Preferred)
        return $Preferred
    }
    for ($port = 49152; $port -le 65535; $port++) {
        if (-not $Reserved.Contains($port) -and (Test-PortFree $port)) {
            [void]$Reserved.Add($port)
            return $port
        }
    }
    throw 'No free loopback TCP port is available.'
}

function Quote-PowerShellLiteral([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }

function Start-OwnedWrapper {
    param(
        [string]$Name,
        [string]$Marker,
        [string]$WorkingDirectory,
        [string]$Executable,
        [string[]]$Arguments,
        [hashtable]$Environment = @{}
    )
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    $environmentStatements = @($Environment.GetEnumerator() | ForEach-Object {
        "`$env:$($_.Key)=$(Quote-PowerShellLiteral ([string]$_.Value));"
    }) -join ' '
    $argumentText = @($Arguments | ForEach-Object { Quote-PowerShellLiteral $_ }) -join ' '
    $command = "& { `$env:SMART_PRINT_DEV_MARKER=$(Quote-PowerShellLiteral $Marker); `$env:SMART_PRINT_DEV_SERVICE=$(Quote-PowerShellLiteral $Name); $environmentStatements Set-Location -LiteralPath $(Quote-PowerShellLiteral $WorkingDirectory); & $(Quote-PowerShellLiteral $Executable) $argumentText; exit `$LASTEXITCODE }"
    $stdout = Join-Path $LogDir "$Name.stdout.log"
    $stderr = Join-Path $LogDir "$Name.stderr.log"
    $process = Start-Process -FilePath $PowerShellExe -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', $command) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    Start-Sleep -Milliseconds 200
    if ($process.HasExited) {
        $details = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
        throw "$Name exited during startup. $details"
    }
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction Stop
    return [ordered]@{
        name = $Name
        pid = $process.Id
        creationDate = ([string]$cim.CreationDate)
        executable = $PowerShellExe
        marker = $Marker
        stdout = $stdout
        stderr = $stderr
    }
}

function Test-OwnedProcess($Service) {
    if (-not $Service -or -not $Service.pid -or -not $Service.marker) { return $false }
    try {
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$Service.pid)" -ErrorAction Stop
        if (-not $cim) { return $false }
        if ([string]$cim.CreationDate -ne [string]$Service.creationDate) { return $false }
        if ([System.IO.Path]::GetFullPath([string]$cim.ExecutablePath) -ne [System.IO.Path]::GetFullPath([string]$Service.executable)) { return $false }
        return ([string]$cim.CommandLine).Contains([string]$Service.marker)
    } catch { return $false }
}

function Get-DescendantProcessIds([int]$RootPid) {
    $all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $children = @{}
    foreach ($item in $all) {
        $parent = [int]$item.ParentProcessId
        if (-not $children.ContainsKey($parent)) { $children[$parent] = New-Object System.Collections.ArrayList }
        [void]$children[$parent].Add([int]$item.ProcessId)
    }
    $result = New-Object System.Collections.ArrayList
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($RootPid)
    while ($queue.Count -gt 0) {
        $parent = [int]$queue.Dequeue()
        if (-not $children.ContainsKey($parent)) { continue }
        foreach ($child in $children[$parent]) { [void]$result.Add($child); $queue.Enqueue($child) }
    }
    return @($result)
}

function Stop-OwnedService($Service) {
    if (-not (Test-OwnedProcess $Service)) {
        Write-Warning "Skipped $($Service.name): recorded PID ownership could not be validated."
        return $false
    }
    $descendants = @(Get-DescendantProcessIds ([int]$Service.pid))
    [array]::Reverse($descendants)
    foreach ($childPid in $descendants) { Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id ([int]$Service.pid) -Force -ErrorAction SilentlyContinue
    return $true
}

function Wait-Http {
    param([string]$Url, [int]$TimeoutSeconds = 45, [int[]]$AcceptedStatus = @(200))
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($AcceptedStatus -contains [int]$response.StatusCode) { return $true }
        } catch {
            $status = $_.Exception.Response.StatusCode.value__
            if ($AcceptedStatus -contains [int]$status) { return $true }
        }
        Start-Sleep -Milliseconds 400
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Get-NgrokExecutable {
    $command = Get-Command ngrok.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'ngrok.exe was not found in PATH. Install ngrok or add its folder to PATH before using START ALL.'
}

function Get-NgrokTunnel([int]$GatewayPort) {
    $expectedTargets = @("http://127.0.0.1:$GatewayPort", "http://localhost:$GatewayPort")
    foreach ($apiPort in 4040..4050) {
        try {
            $apiUrl = "http://127.0.0.1:$apiPort/api/tunnels"
            $response = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 1
            $tunnel = @($response.tunnels | Where-Object {
                $_.public_url -eq $NgrokDomain -and $expectedTargets -contains ([string]$_.config.addr).TrimEnd('/')
            }) | Select-Object -First 1
            if ($tunnel) { return [pscustomobject]@{ tunnel = $tunnel; apiPort = $apiPort; apiUrl = $apiUrl } }
        } catch {}
    }
    return $null
}

function Wait-NgrokTunnel([int]$GatewayPort, [int]$TimeoutSeconds = 30) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $tunnel = Get-NgrokTunnel $GatewayPort
        if ($tunnel) { return $tunnel }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    return $null
}

function Get-NgrokApiOwnerPid([int]$ApiPort) {
    try {
        return @(Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $ApiPort -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)[0]
    } catch { return $null }
}

function Read-NgrokFailure([string]$LogPath, [string]$ErrorLogPath) {
    if (Test-Path -LiteralPath $ErrorLogPath) {
        $stderr = Get-Content -LiteralPath $ErrorLogPath -Raw -ErrorAction SilentlyContinue
        if ($stderr) { Add-Content -LiteralPath $LogPath -Value $stderr -Encoding UTF8 }
        Remove-Item -LiteralPath $ErrorLogPath -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path -LiteralPath $LogPath)) { return 'ngrok exited without producing a log.' }
    return @(Get-Content -LiteralPath $LogPath -Tail 20 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
}

function Start-OwnedNgrok([int]$GatewayPort, [string]$Marker) {
    $ngrok = Get-NgrokExecutable
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    $logPath = Join-Path $LogDir 'ngrok.log'
    $errorLogPath = Join-Path $LogDir 'ngrok.stderr.tmp.log'
    Set-Content -LiteralPath $logPath -Value '' -Encoding UTF8
    Remove-Item -LiteralPath $errorLogPath -Force -ErrorAction SilentlyContinue
    $arguments = @('http', [string]$GatewayPort, "--url=$NgrokDomain", '--log=stdout', '--log-format=logfmt', '--log-level=info')
    $process = Start-Process -FilePath $ngrok -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errorLogPath -PassThru
    Start-Sleep -Seconds 2
    $process.Refresh()
    if ($process.HasExited) {
        $details = Read-NgrokFailure $logPath $errorLogPath
        if ($details -match 'ERR_NGROK_334') { throw "ERR_NGROK_334: the fixed ngrok domain is already online for a different forwarding target. $details" }
        throw "ngrok exited during startup. $details"
    }
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction Stop
    return [ordered]@{
        name = 'ngrok'
        pid = $process.Id
        creationDate = ([string]$cim.CreationDate)
        executable = $ngrok
        marker = $NgrokDomainHost
        launchMarker = $Marker
        log = $logPath
        stderr = $errorLogPath
    }
}

function Stop-All {
    $runtime = Read-Runtime
    if (-not $runtime) { Write-Host 'No manager-owned runtime is recorded.' -ForegroundColor Yellow; return }
    $allStopped = $true
    foreach ($name in @('ngrok', 'web', 'gateway', 'engine')) {
        $service = $runtime.services.$name
        if ($service) {
            $stopped = Stop-OwnedService $service
            $allStopped = $allStopped -and $stopped
            if ($stopped) { Write-Host "Stopped manager-owned $name process tree." -ForegroundColor Green }
        }
    }
    if ($allStopped) { Remove-Item -LiteralPath $RuntimeFile -Force; Write-Host 'Runtime state removed.' -ForegroundColor Green }
    else { Write-Warning 'runtime.json was retained because one or more ownership checks failed.' }
}

function Start-All {
    $existing = Read-Runtime
    if ($existing) {
        $hasLiveOwnedService = $false
        foreach ($property in $existing.services.PSObject.Properties) {
            if ([bool](Test-OwnedProcess $property.Value)) { $hasLiveOwnedService = $true; break }
        }
        if ($hasLiveOwnedService) { throw 'Manager-owned services are already running. Use STOP ALL first.' }
        Remove-Item -LiteralPath $RuntimeFile -Force
    }
    if (-not (Test-Path -LiteralPath $EngineRoot -PathType Container)) { throw "IM_AI_ENGINE folder is missing: $EngineRoot" }
    $python = Join-Path $EngineRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw "IM_AI_ENGINE virtual environment is missing: $python" }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $vite = Join-Path $ProjectRoot 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $vite -PathType Leaf)) { throw 'Vite is not installed. Run npm install first.' }

    $reserved = [System.Collections.Generic.HashSet[int]]::new()
    $enginePort = Select-FreePort 8010 $reserved
    $gatewayPort = Select-FreePort 3001 $reserved
    $webPort = Select-FreePort 8080 $reserved
    $marker = [guid]::NewGuid().ToString('N')
    $runtime = [ordered]@{
        version = 1
        marker = $marker
        state = 'starting'
        createdAt = [DateTime]::UtcNow.ToString('o')
        ports = [ordered]@{ engine = $enginePort; gateway = $gatewayPort; web = $webPort }
        urls = [ordered]@{
            engine = "http://127.0.0.1:$enginePort"
            gateway = "http://127.0.0.1:$gatewayPort"
            web = "http://127.0.0.1:$webPort"
            ngrok = $NgrokDomain
            metaCallback = $MetaCallback
        }
        ngrokForwardingTarget = "http://127.0.0.1:$gatewayPort"
        ngrokStatus = if ($LocalOnly) { 'disabled for local validation' } else { 'starting' }
        ngrokPublicVerification = 'not attempted'
        ngrokPid = $null
        ngrokApiUrl = $null
        ngrokReused = $false
        warnings = @()
        services = [ordered]@{}
    }
    Write-Runtime $runtime
    try {
        $runtime.services.engine = Start-OwnedWrapper -Name 'engine' -Marker "$marker-engine" -WorkingDirectory $EngineRoot -Executable $python -Arguments @('-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', [string]$enginePort)
        Write-Runtime $runtime
        if (-not (Wait-Http "$($runtime.urls.engine)/api/health" 60)) { throw 'IM_AI_ENGINE health check timed out.' }

        $runtime.services.gateway = Start-OwnedWrapper -Name 'gateway' -Marker "$marker-gateway" -WorkingDirectory $ProjectRoot -Executable $node -Arguments @('backend/whatsapp-gateway.mjs', "--smart-print-dev-manager=$marker") -Environment @{
            WHATSAPP_GATEWAY_PORT = [string]$gatewayPort
            IM_AI_ENGINE_URL = $runtime.urls.engine
            PRINTDESK_APP_ROOT = $ProjectRoot
        }
        Write-Runtime $runtime
        if (-not (Wait-Http "$($runtime.urls.gateway)/api/health" 45)) { throw 'WhatsApp Gateway health check timed out.' }
        $localWebhookProbe = "$($runtime.urls.gateway)/api/meta/webhook?hub.mode=subscribe&hub.verify_token=manager-diagnostic-invalid&hub.challenge=manager"
        if (-not (Wait-Http $localWebhookProbe 5 @(403))) { throw 'WhatsApp Gateway Meta webhook route is not ready.' }

        if (-not $LocalOnly) {
            try {
                $tunnel = Get-NgrokTunnel $gatewayPort
                if ($tunnel) {
                    $runtime.ngrokReused = $true
                    $runtime.ngrokApiUrl = $tunnel.apiUrl
                    $runtime.ngrokPid = Get-NgrokApiOwnerPid ([int]$tunnel.apiPort)
                    $runtime.ngrokStatus = 'matching tunnel reused'
                    Write-Host "Reusing matching ngrok tunnel at $($tunnel.apiUrl); no duplicate process started." -ForegroundColor Green
                } else {
                    $runtime.services.ngrok = Start-OwnedNgrok $gatewayPort "$marker-ngrok"
                    $runtime.ngrokPid = $runtime.services.ngrok.pid
                    Write-Runtime $runtime
                    $tunnel = Wait-NgrokTunnel $gatewayPort 30
                    if (-not (Test-OwnedProcess $runtime.services.ngrok)) {
                        $details = Read-NgrokFailure $runtime.services.ngrok.log $runtime.services.ngrok.stderr
                        if ($details -match 'ERR_NGROK_334') { throw "ERR_NGROK_334: the fixed ngrok domain is already online for a different forwarding target. $details" }
                        throw "ngrok process exited before its local tunnel became ready. $details"
                    }
                    if (-not $tunnel) { throw "ngrok process remains alive, but no matching tunnel was found through local APIs on ports 4040-4050 for gateway port $gatewayPort." }
                    $runtime.ngrokApiUrl = $tunnel.apiUrl
                    $runtime.ngrokStatus = 'owned tunnel ready'
                }
                if ($tunnel) {
                    $verificationProbe = "$MetaCallback`?hub.mode=subscribe&hub.verify_token=manager-diagnostic-invalid&hub.challenge=manager"
                    if (Wait-Http $verificationProbe 20 @(403)) {
                        $runtime.ngrokPublicVerification = 'verified'
                    } else {
                        $runtime.ngrokPublicVerification = 'unverified'
                        $warning = 'ngrok tunnel is locally ready, but public Meta callback verification could not be completed. Check internet access and ngrok status.'
                        $runtime.warnings += $warning
                        Write-Warning $warning
                    }
                }
            } catch {
                $runtime.ngrokStatus = 'startup warning'
                $runtime.ngrokPublicVerification = 'unverified'
                $warning = "ngrok startup could not be confirmed: $($_.Exception.Message)"
                $runtime.warnings += $warning
                Write-Warning $warning
            }
            Write-Runtime $runtime
        }

        $runtime.services.web = Start-OwnedWrapper -Name 'web' -Marker "$marker-web" -WorkingDirectory $ProjectRoot -Executable $node -Arguments @($vite, '--host', '127.0.0.1', '--port', [string]$webPort, '--strictPort') -Environment @{
            VITE_GATEWAY_URL = $runtime.urls.gateway
        }
        Write-Runtime $runtime
        if (-not (Wait-Http $runtime.urls.web 60)) { throw 'Vite health check timed out.' }

        $runtime.state = 'running'
        $runtime.startedAt = [DateTime]::UtcNow.ToString('o')
        Write-Runtime $runtime
        Show-Status
        if (-not $NoOpen) { Start-Process $runtime.urls.web }
    } catch {
        Write-Error $_
        foreach ($name in @('ngrok', 'web', 'gateway', 'engine')) {
            $service = $runtime.services.$name
            if ($service) { [void](Stop-OwnedService $service) }
        }
        Remove-Item -LiteralPath $RuntimeFile -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Get-ServiceHealth([string]$Name, $Runtime, $Service) {
    if ($Name -eq 'ngrok') {
        return $(if (Get-NgrokTunnel ([int]$Runtime.ports.gateway)) { [string]$Runtime.ngrokStatus } else { 'local tunnel unavailable' })
    }
    if (-not (Test-OwnedProcess $Service)) { return 'not owned/running' }
    $url = switch ($Name) {
        'engine' { "$($Runtime.urls.engine)/api/health" }
        'gateway' { "$($Runtime.urls.gateway)/api/health" }
        'web' { $Runtime.urls.web }
    }
    return $(if (Wait-Http $url 2 @(200)) { 'healthy' } else { 'unreachable' })
}

function Show-Status {
    $runtime = Read-Runtime
    if (-not $runtime) { Write-Host 'No manager-owned runtime is recorded.' -ForegroundColor Yellow; return }
    $serviceNames = @('engine', 'gateway', 'web') + $(if (-not $LocalOnly -and $runtime.ngrokStatus) { @('ngrok') } else { @() })
    $rows = foreach ($name in $serviceNames) {
        $service = $runtime.services.$name
        $port = if ($name -eq 'ngrok') { '-' } else { $runtime.ports.$name }
        $url = if ($name -eq 'ngrok') { $runtime.urls.ngrok } else { $runtime.urls.$name }
        $servicePid = if ($name -eq 'ngrok') { $runtime.ngrokPid } else { $service.pid }
        [pscustomobject]@{ Service = $name; Port = $port; PID = $servicePid; Health = Get-ServiceHealth $name $runtime $service; URL = $url }
    }
    $rows | Format-Table -AutoSize
    Write-Host "ngrok forwarding target: $($runtime.ngrokForwardingTarget)"
    Write-Host "Meta callback: $($runtime.urls.metaCallback)"
    if ($runtime.ngrokPublicVerification) { Write-Host "ngrok public verification: $($runtime.ngrokPublicVerification)" }
    foreach ($warning in @($runtime.warnings | Where-Object { $_ })) { Write-Warning $warning }
}

function Show-Urls {
    $runtime = Read-Runtime
    if (-not $runtime) { Write-Host 'No manager-owned runtime is recorded.' -ForegroundColor Yellow; return }
    Write-Host "IM_AI_ENGINE:  $($runtime.urls.engine)"
    Write-Host "Gateway:       $($runtime.urls.gateway)"
    Write-Host "PRINT MASTER:  $($runtime.urls.web)"
    Write-Host "ngrok:         $($runtime.urls.ngrok) -> $($runtime.ngrokForwardingTarget)"
    Write-Host "Meta callback: $($runtime.urls.metaCallback)"
    Write-Host "ngrok status:  $($runtime.ngrokStatus); public verification: $($runtime.ngrokPublicVerification)"
}

function Open-PrintMaster {
    $runtime = Read-Runtime
    if (-not $runtime -or -not (Test-OwnedProcess $runtime.services.web)) { throw 'The manager-owned Vite service is not running.' }
    Start-Process $runtime.urls.web
}

function Show-Menu {
    while ($true) {
        Write-Host ''
        Write-Host 'ISHITA PRINT MASTER - DEVELOPMENT MANAGER' -ForegroundColor Cyan
        Write-Host '1. START ALL'
        Write-Host '2. STOP ALL'
        Write-Host '3. CHECK STATUS'
        Write-Host '4. OPEN PRINT MASTER'
        Write-Host '5. SHOW ACTIVE URLS'
        Write-Host '6. EXIT'
        $choice = Read-Host 'Select an option'
        try {
            switch ($choice) {
                '1' { Start-All }
                '2' { Stop-All }
                '3' { Show-Status }
                '4' { Open-PrintMaster }
                '5' { Show-Urls }
                '6' { return }
                default { Write-Warning 'Choose a number from 1 to 6.' }
            }
        } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
    }
}

Set-Location -LiteralPath $ProjectRoot
switch ($Action) {
    'Start' { Start-All }
    'Stop' { Stop-All }
    'Status' { Show-Status }
    'Open' { Open-PrintMaster }
    'Urls' { Show-Urls }
    default { Show-Menu }
}
