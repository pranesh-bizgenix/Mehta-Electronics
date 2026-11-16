$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$path=Join-Path $root 'scripts\update-tally-sales-connector.ps1'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Updater PowerShell syntax is invalid.' }
# Load only function definitions, never the script body or service operations.
foreach ($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) { Invoke-Expression $definition.Extent.Text }
$base=Join-Path $root 'backups'
$temporaryRoot=Assert-ChildPath $base (Join-Path $base ('ZZTEST_connector-update-'+[guid]::NewGuid().ToString('N')))
$checks=0
try {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    $rejected=$false;try { Assert-UpdateAdministrator $false $false } catch { $rejected=$_.Exception.Message -match 'Run as administrator' }
    if (-not $rejected) { throw 'Apply mode did not reject a non-administrator.' };$checks++
    Assert-UpdateAdministrator $false $true;$checks++
    $rejected=$false;try { Assert-ChildPath $temporaryRoot (Join-Path $temporaryRoot '..\escape') | Out-Null } catch { $rejected=$true }
    if (-not $rejected) { throw 'Traversal was accepted.' };$checks++
    $target=Join-Path $temporaryRoot 'target';$saved=Join-Path $temporaryRoot 'backup'
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $saved 'service\nested') -Force | Out-Null
    $original=Join-Path $saved 'service\nested\original.dll'
    Set-Content -LiteralPath $original -Value 'ZZTEST original bytes'
    $hash=(Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash
    Test-FileHash $original $hash;$checks++
    $rejected=$false;try { Test-FileHash $original ('0'*64) } catch { $rejected=$true }
    if (-not $rejected) { throw 'Wrong hash was accepted.' };$checks++
    New-Item -ItemType Directory -Path (Join-Path $target 'nested') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $target 'nested\original.dll') -Value 'ZZTEST overwritten bytes'
    Set-Content -LiteralPath (Join-Path $target 'new.dll') -Value 'ZZTEST added bytes'
    $plan=@{target=$target;backup=$saved;original=@{'nested\original.dll'=$hash};payload=@(@{path='nested\original.dll'},@{path='new.dll'})}
    Restore-Profile $plan
    Test-FileHash (Join-Path $target 'nested\original.dll') $hash;$checks++
    if ((Test-Path -LiteralPath (Join-Path $target 'new.dll')) -or -not (Test-Path -LiteralPath (Join-Path $saved 'added-on-failed-update\new.dll'))) { throw 'Added file was not quarantined.' };$checks++
    # Validate branch must precede any installed-profile/service preflight.
    $source=Get-Content -LiteralPath $path -Raw
    if ($source.IndexOf("if (`$ValidateOnly) { `$result.stage='release-validated'") -lt 0 -or $source.IndexOf("`$result.stage='service-preflight'") -lt $source.IndexOf("if (`$ValidateOnly) { `$result.stage='release-validated'")) { throw 'Validation-only service isolation is missing.' };$checks++
    if ($source -match '(?im)^\s*(New-Service|Install-Service|sc\.exe|Remove-Item)\b') { throw 'Unexpected install/delete command.' };$checks++
    if ($source.IndexOf('Assert-UpdateAdministrator $result.administrator') -gt $source.IndexOf("`$result.stage='release-validation'")) { throw 'Administrator check must precede release and installed-service checks.' }
    Write-Output ("PASS: $checks updater syntax/path/hash/restore/isolation checks; no installed service was touched.")
} finally {
    # One native PowerShell shell, checked absolute path, fixture subtree only.
    $safe=Assert-ChildPath $base $temporaryRoot
    if ((Split-Path -Leaf $safe) -notlike 'ZZTEST_connector-update-*') { throw 'Unsafe fixture cleanup path.' }
    if (Test-Path -LiteralPath $safe) { Remove-Item -LiteralPath $safe -Recurse -Force }
}
