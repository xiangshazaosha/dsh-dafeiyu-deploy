[CmdletBinding()]
param(
    [string[]]$Path = @(),
    [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
    [switch]$NoDefaultRoots
)
$ErrorActionPreference = 'Stop'
# Read-only discovery. Never starts QQ/SnowLuma, authenticates, records consent,
# changes credentials, or invokes a load endpoint.
$candidates = @{}
function Add-Candidate([string]$Value, [string]$Source) {
    if (-not $Value -or -not [IO.Path]::IsPathRooted($Value)) { return }
    try { $full = [IO.Path]::GetFullPath($Value).TrimEnd('\') } catch { return }
    if (-not $candidates.ContainsKey($full)) { $candidates[$full] = [Collections.Generic.List[string]]::new() }
    if (-not $candidates[$full].Contains($Source)) { $candidates[$full].Add($Source) }
}
function Read-Json([string]$File) {
    try { Get-Content -LiteralPath $File -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { $null }
}
$config = Read-Json (Join-Path $DshHome 'plugins-data\aurabot\config.json')
Add-Candidate $config.snowluma.dir 'Aurabot configuration'
foreach ($item in $Path) { Add-Candidate $item 'Explicit path' }
$processes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)
foreach ($proc in $processes) {
    if ($proc.ExecutablePath -and $proc.CommandLine -match 'index\.mjs') {
        Add-Candidate (Split-Path -Parent $proc.ExecutablePath) 'Running Node executable directory'
        if ($proc.CommandLine -match '"([A-Za-z]:\\[^"\r\n]*\\index\.mjs)"') {
            Add-Candidate (Split-Path -Parent $Matches[1]) 'Running entry path'
        } elseif ($proc.CommandLine -match '([A-Za-z]:\\[^\s"]*\\index\.mjs)') {
            Add-Candidate (Split-Path -Parent $Matches[1]) 'Running entry path'
        }
    }
}
if (-not $NoDefaultRoots) {
    foreach ($drive in Get-PSDrive -PSProvider FileSystem) {
        Add-Candidate (Join-Path $drive.Root 'SnowLuma') 'Bounded conventional path'
        Add-Candidate (Join-Path $drive.Root 'DSH\SnowLuma') 'Bounded conventional path'
    }
    Add-Candidate (Join-Path $env:USERPROFILE 'SnowLuma') 'User directory'
}
$found = @(foreach ($dir in ($candidates.Keys | Sort-Object)) {
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'index.mjs') -PathType Leaf)) { continue }
    $pkg = Read-Json (Join-Path $dir 'package.json')
    if ($pkg.name -notmatch '(?i)snowluma') { continue }
    $release = Read-Json (Join-Path $dir 'release.json')
    $runtime = Read-Json (Join-Path $dir 'config\runtime.json')
    $matching = @($processes | Where-Object {
        ($_.ExecutablePath -and (Split-Path -Parent $_.ExecutablePath) -eq $dir -and $_.CommandLine -match 'index\.mjs') -or
        ($_.CommandLine -and $_.CommandLine.IndexOf((Join-Path $dir 'index.mjs'), [StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    [pscustomobject]@{
        Directory=$dir; Version=$(if ($release.version) { $release.version } else { $pkg.version })
        Evidence=@($candidates[$dir]); RunningProcessIds=@($matching | Select-Object -ExpandProperty ProcessId)
        HasBundledNode=(Test-Path -LiteralPath (Join-Path $dir 'node.exe') -PathType Leaf)
        HasWebuiCredentialsFile=(Test-Path -LiteralPath (Join-Path $dir 'config\webui.json') -PathType Leaf)
        HasConsentRecord=(Test-Path -LiteralPath (Join-Path $dir 'config\consent.json') -PathType Leaf)
        HookAutoLoad=$runtime.hookAutoLoad
        AurabotConfiguredDirectoryMatches=($config.snowluma.dir -eq $dir)
        AurabotHasSavedControlPassword=([bool]$config.snowluma.webuiPassword -and $config.snowluma.dir -eq $dir)
        Health='Candidate only; authentication, consent validity, QQ identity and end-to-end operation not verified'
    }
})
[pscustomobject]@{Candidates=$found;Count=$found.Count;ReadOnly=$true;AutoSelected=$false} | ConvertTo-Json -Depth 5
