#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $workspaceRoot 'docs\tally-sales-connector-update.json') -Raw | ConvertFrom-Json
$releaseExe = Join-Path $workspaceRoot $manifest.release
if ((Get-FileHash -LiteralPath $releaseExe -Algorithm SHA256).Hash -ne $manifest.sha256) { throw 'Release checksum mismatch. Rebuild and verify the connector before updating.' }
$backupRoot = Join-Path $workspaceRoot 'output\tally-sales-review\connector-backup'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($profile in $manifest.profiles) {
    $profileFile = Join-Path 'C:\ProgramData\Bizgenix\TallyConnector\profiles' ($profile.name + '\config\connector.json')
    $configuration = Get-Content -LiteralPath $profileFile -Raw | ConvertFrom-Json
    if ($configuration.apiBaseUrl -ne $manifest.apiBaseUrl -or $configuration.preferredCompany -ne $manifest.company) { throw 'Connector company/endpoint changed. No update applied to this profile.' }
    $targetExe = Join-Path 'C:\Program Files\Bizgenix\TallyConnector\profiles' ($profile.name + '\TallyConnector.Service.exe')
    $backupExe = Join-Path $backupRoot ($profile.name + '.Service.exe')
    if (-not (Test-Path -LiteralPath $backupExe)) { Copy-Item -LiteralPath $targetExe -Destination $backupExe }
    $serviceName = 'BizgenixTallyConnector-' + $profile.name
    Stop-Service -Name $serviceName -ErrorAction Stop
    try {
        Copy-Item -LiteralPath $releaseExe -Destination $targetExe -Force
        Start-Service -Name $serviceName -ErrorAction Stop
        if ((Get-Service -Name $serviceName).Status -ne 'Running') { throw 'Updated service did not start.' }
        Write-Output ('Updated and running: ' + $serviceName)
    } catch {
        Stop-Service -Name $serviceName -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath $backupExe -Destination $targetExe -Force
        Start-Service -Name $serviceName
        throw
    }
}
Write-Output 'Update complete. Existing credentials, company settings, checkpoints and queued data were preserved.'
