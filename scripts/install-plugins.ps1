[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$DshCli,
    [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Profile = 'desktop',
    [Parameter(Mandatory = $true)][ValidateSet('aurabot','pet')][string[]]$Plugins
)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($DshCli) -or -not (Test-Path -LiteralPath $DshCli -PathType Leaf)) {
    throw 'Supply the absolute path of the already-installed DSH CLI.'
}
if ($Profile -eq 'desktop' -and (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
    throw 'Fully quit DSH from its tray first; do not interrupt active tasks.'
}
$packages = @{ aurabot = 'github:accomplish07zrh-eng/dsh-aurabot-qq'; pet = 'dsh-pet' }
# The caller must first inspect the selected profile and pass only missing, requested plugins.
foreach ($name in ($Plugins | Select-Object -Unique)) {
    $package = $packages[$name]
    if ($PSCmdlet.ShouldProcess("DSH profile $Profile", "Install $package")) {
        & $DshCli plugin --profile $Profile add $package
        if ($LASTEXITCODE -ne 0) { throw "Plugin installation failed ($LASTEXITCODE): $package" }
    }
}
Write-Output 'No QQ gateway was installed. Restart DSH and verify plugin loading separately.'
