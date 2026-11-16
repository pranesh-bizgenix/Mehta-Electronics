[CmdletBinding()]
param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$workspaceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N')
$resultDirectory = Join-Path $workspaceRoot 'output\tally-sales-review\connector-update-results'
$resultFile = Join-Path $resultDirectory ($runId + '.json')
$backupRoot = Join-Path $workspaceRoot ('backups\connector-update\' + $runId)
$result = [ordered]@{runId=$runId;mode=$(if ($ValidateOnly) {'VALIDATE_ONLY'} else {'UPDATE'});startedAt=[DateTime]::UtcNow.ToString('o');completedAt=$null;success=$false;stage='administrator';administrator=$false;connectorVersion=$null;backupRoot=$null;profiles=@();error=$null}
$plans=@();$servicesTouched=$false
function Stop-Update([string]$Message) {
    $failure=New-Object System.InvalidOperationException($Message)
    $failure.Data['SafeUpdateMessage']=$true
    throw $failure
}
function Assert-UpdateAdministrator([bool]$Administrator,[bool]$ValidationOnly) {
    if (-not $ValidationOnly -and -not $Administrator) { Stop-Update 'Administrator rights are required. Open Windows PowerShell using Run as administrator, change to this repository, then run .\scripts\update-tally-sales-connector.ps1. Use -ValidateOnly to check the release without changing services.' }
}
function Assert-ChildPath([string]$Root,[string]$Path) {
    $base=[IO.Path]::GetFullPath($Root).TrimEnd('\')+'\'
    $full=[IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)) { Stop-Update 'A path escapes its permitted directory. No further files will be changed.' }
    return $full
}
function Assert-NoLinks([string]$Path) {
    $entry=Get-Item -LiteralPath $Path -Force
    while ($null -ne $entry) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Update 'Junctions and symbolic links are not supported in update paths.' }
        $entry=$entry.Parent
    }
    if (@(Get-ChildItem -LiteralPath $Path -Force -Recurse | Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count) { Stop-Update 'An update folder contains a junction or symbolic link.' }
}
function Get-RelativeFile([string]$Root,[string]$Path) {
    $safe=Assert-ChildPath $Root $Path
    return $safe.Substring(([IO.Path]::GetFullPath($Root).TrimEnd('\')+'\').Length)
}
function Test-FileHash([string]$Path,[string]$Expected) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Expected) { Stop-Update 'A file is missing or its SHA256 does not match. Update cannot continue.' }
}
function Wait-ServiceState([string]$Name,[string]$State) {
    $service=Get-Service -Name $Name
    $service.WaitForStatus([Enum]::Parse([ServiceProcess.ServiceControllerStatus],$State),[TimeSpan]::FromSeconds(30))
    $service.Refresh()
    if ([string]$service.Status -ne $State) { Stop-Update 'A Mehta service did not reach the required state within 30 seconds.' }
}
function Restore-Profile($Plan) {
    # New files go to quarantine; restore original files without deleting folders.
    foreach ($file in $Plan.payload) {
        $destination=Assert-ChildPath $Plan.target (Join-Path $Plan.target $file.path)
        if (-not $Plan.original.ContainsKey($file.path) -and (Test-Path -LiteralPath $destination -PathType Leaf)) {
            $quarantine=Assert-ChildPath $Plan.backup (Join-Path $Plan.backup ('added-on-failed-update\'+$file.path))
            New-Item -ItemType Directory -Path (Split-Path -Parent $quarantine) -Force | Out-Null
            Move-Item -LiteralPath $destination -Destination $quarantine -Force
        }
    }
    foreach ($relative in $Plan.original.Keys) {
        $saved=Assert-ChildPath $Plan.backup (Join-Path $Plan.backup ('service\'+$relative))
        Test-FileHash $saved $Plan.original[$relative]
        $destination=Assert-ChildPath $Plan.target (Join-Path $Plan.target $relative)
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $saved -Destination $destination -Force
        Test-FileHash $destination $Plan.original[$relative]
    }
}
try {
    # Apply mode must fail before reading profiles or touching either service.
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=New-Object Security.Principal.WindowsPrincipal($identity)
    $result.administrator=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Assert-UpdateAdministrator $result.administrator ([bool]$ValidateOnly)
    $result.stage='release-validation'
    $manifest=Get-Content -LiteralPath (Join-Path $workspaceRoot 'docs\tally-sales-connector-update.json') -Raw | ConvertFrom-Json
    $releaseRoot=Assert-ChildPath $workspaceRoot (Join-Path $workspaceRoot $manifest.releaseDirectory)
    Assert-NoLinks $releaseRoot
    if (@($manifest.profiles).Count -ne 2 -or @($manifest.profiles.name | Sort-Object -Unique).Count -ne 2) { Stop-Update 'The manifest must name both distinct Mehta service profiles.' }
    foreach ($profile in $manifest.profiles) { if ($profile.name -notin @('mehta-electronics','mehta-electric-corporation-from')) { Stop-Update 'Unexpected service profile. Only the two existing Mehta services may be updated.' } }
    if ($manifest.connectorVersion -notmatch '^\d+\.\d+\.\d+$') { Stop-Update 'An explicit connector version is required in the release manifest.' }
    $result.connectorVersion=$manifest.connectorVersion
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { Stop-Update '.NET 8 runtime is required. Ask the administrator to prepare the approved runtime before updating.' }
    if (-not ((& dotnet --list-runtimes) -match '^Microsoft\.NETCore\.App 8\.')) { Stop-Update '.NET 8 runtime is required. Ask the administrator to prepare the approved runtime before updating.' }
    $payload=@($manifest.files);$paths=@{}
    if (-not $payload.Count) { Stop-Update 'A SHA256 manifest is required for every copied file.' }
    foreach ($file in $payload) {
        if ([IO.Path]::IsPathRooted($file.path) -or $file.path -match '(^|[\\/])\.\.([\\/]|$)' -or $file.path -match '(^|[\\/])appsettings.*\.json$' -or $file.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or $paths.ContainsKey($file.path)) { Stop-Update 'The manifest has an unsafe, duplicate or invalid payload entry.' }
        $paths[$file.path]=$true
        Test-FileHash (Assert-ChildPath $releaseRoot (Join-Path $releaseRoot $file.path)) $file.sha256
    }
    $actual=@(Get-ChildItem -LiteralPath $releaseRoot -File -Force -Recurse | Where-Object {$_.Name -notlike 'appsettings*.json'})
    if ($actual.Count -ne $payload.Count) { Stop-Update 'Release file count differs from the reviewed manifest.' }
    foreach ($file in $actual) { if (-not $paths.ContainsKey((Get-RelativeFile $releaseRoot $file.FullName))) { Stop-Update 'An unreviewed file exists in the release.' } }
    if (-not $paths.ContainsKey($manifest.releaseExe) -or -not $paths.ContainsKey($manifest.coreAssembly) -or -not $paths.ContainsKey('TallyConnector.Service.dll')) { Stop-Update 'The executable, service assembly and core assembly must all be in the manifest.' }
    Test-FileHash (Join-Path $releaseRoot $manifest.releaseExe) $manifest.sha256
    Test-FileHash (Join-Path $releaseRoot $manifest.coreAssembly) $manifest.coreSha256
    $coreVersion=[Reflection.AssemblyName]::GetAssemblyName((Join-Path $releaseRoot $manifest.coreAssembly)).Version.ToString(3)
    if ($coreVersion -ne $manifest.connectorVersion) { Stop-Update 'Core assembly version differs from the reviewed manifest.' }
    if ($ValidateOnly) { $result.stage='release-validated';$result.success=$true }
    else {
        $result.stage='service-preflight'
        foreach ($profile in $manifest.profiles) {
            $name=[string]$profile.name;$base='C:\Program Files\Bizgenix\TallyConnector\profiles'
            $target=Assert-ChildPath $base (Join-Path $base $name)
            Assert-NoLinks $target
            $configuration=Get-Content -LiteralPath (Join-Path 'C:\ProgramData\Bizgenix\TallyConnector\profiles' ($name+'\config\connector.json')) -Raw | ConvertFrom-Json
            if ($configuration.apiBaseUrl -ne $manifest.apiBaseUrl -or $configuration.preferredCompany -ne $manifest.company) { Stop-Update 'A Mehta profile no longer matches the reviewed app address/company. Review the manifest before updating.' }
            $serviceName='BizgenixTallyConnector-'+$name
            $registration=Get-CimInstance Win32_Service -Filter ("Name='"+$serviceName+"'")
            if (-not $registration -or $registration.PathName -notmatch '^"?(.+?\.exe)"?(?:\s|$)') { Stop-Update 'An existing Mehta service registration could not be verified. This script never installs services.' }
            if ([IO.Path]::GetFullPath($Matches[1]) -ne (Join-Path $target $manifest.releaseExe)) { Stop-Update 'A Mehta service points to a different folder. No services were stopped.' }
            $row=[ordered]@{profile=$name;service=$serviceName;initialState=[string](Get-Service -Name $serviceName).Status;backupVerified=$false;copyVerified=$false;running=$false;rollback=$null}
            if ($row.initialState -notin @('Running','Stopped')) { Stop-Update 'Both services must be in a stable Running or Stopped state before updating.' }
            $result.profiles+=$row
            $plans+=@{target=$target;backup=(Join-Path $backupRoot $name);original=@{};payload=$payload;row=$row;service=$serviceName}
        }
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        Assert-NoLinks $backupRoot
        # Full backups can contain local appsettings: restrict access first.
        & icacls $backupRoot '/inheritance:r' '/grant:r' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
        if ($LASTEXITCODE -ne 0) { Stop-Update 'Could not restrict backup access to Administrators and SYSTEM.' }
        $result.backupRoot=$backupRoot;$result.stage='stop-services';$servicesTouched=$true
        foreach ($plan in $plans) { Stop-Service -Name $plan.service;Wait-ServiceState $plan.service 'Stopped' }
        $result.stage='backup-services'
        foreach ($plan in $plans) {
            $savedRoot=Join-Path $plan.backup 'service'
            New-Item -ItemType Directory -Path $savedRoot -Force | Out-Null
            foreach ($file in Get-ChildItem -LiteralPath $plan.target -File -Force -Recurse) { $plan.original[(Get-RelativeFile $plan.target $file.FullName)]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
            Get-ChildItem -LiteralPath $plan.target -Force | Copy-Item -Destination $savedRoot -Recurse -Force
            foreach ($relative in $plan.original.Keys) { Test-FileHash (Assert-ChildPath $savedRoot (Join-Path $savedRoot $relative)) $plan.original[$relative] }
            if (@(Get-ChildItem -LiteralPath $savedRoot -File -Force -Recurse).Count -ne $plan.original.Count) { Stop-Update 'The complete service-folder backup could not be verified.' }
            $plan.original | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $plan.backup 'inventory-sha256.json') -Encoding UTF8
            $plan.row.backupVerified=$true
        }
        $result.stage='copy-and-verify'
        foreach ($plan in $plans) {
            foreach ($file in $payload) {
                $source=Assert-ChildPath $releaseRoot (Join-Path $releaseRoot $file.path)
                $destination=Assert-ChildPath $plan.target (Join-Path $plan.target $file.path)
                Test-FileHash $source $file.sha256
                New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
                Copy-Item -LiteralPath $source -Destination $destination -Force
                Test-FileHash $destination $file.sha256
            }
            $plan.row.copyVerified=$true
        }
        $result.stage='restart-services'
        foreach ($plan in $plans) { Start-Service -Name $plan.service;Wait-ServiceState $plan.service 'Running';$plan.row.running=$true }
        $result.stage='completed';$result.success=$true
    }
} catch {
    $result.error='Update failed during '+$result.stage+'. Review the result and verified backups before retrying.'
    if ($_.Exception.Data.Contains('SafeUpdateMessage')) { $result.error=$_.Exception.Message }
    if ($servicesTouched) {
        # Stop both before restoring either, including an already-restarted peer.
        $stopped=@{}
        foreach ($plan in $plans) { try { Stop-Service -Name $plan.service;Wait-ServiceState $plan.service 'Stopped';$stopped[$plan.service]=$true } catch { $plan.row.rollback='STOP_FAILED_MANUAL_RECOVERY_REQUIRED';$plan.row.running=$false } }
        foreach ($plan in $plans) {
            if (-not $stopped.ContainsKey($plan.service)) { continue }
            try {
                if ($plan.row.backupVerified -and $result.stage -in @('copy-and-verify','restart-services')) { Restore-Profile $plan }
                if ($plan.row.initialState -eq 'Running') { Start-Service -Name $plan.service;Wait-ServiceState $plan.service 'Running';$plan.row.running=$true } else { $plan.row.running=$false }
                $plan.row.rollback='ORIGINAL_FILES_AND_STATE_RESTORED'
            } catch { $plan.row.rollback='RESTORE_FAILED_MANUAL_RECOVERY_REQUIRED';$plan.row.running=$false }
        }
    }
} finally {
    $result.completedAt=[DateTime]::UtcNow.ToString('o')
    New-Item -ItemType Directory -Path $resultDirectory -Force | Out-Null
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultFile -Encoding UTF8
    Write-Output ('Result file: '+$resultFile)
}
if (-not $result.success) { throw $result.error }
if ($ValidateOnly) { Write-Output 'Release hashes/version validated. No service or installed file was changed. Applying requires Administrator rights.' }
else { Write-Output 'Both Mehta services are running with verified files. Refresh /tally/connector after the next heartbeat to verify the reported version.' }
