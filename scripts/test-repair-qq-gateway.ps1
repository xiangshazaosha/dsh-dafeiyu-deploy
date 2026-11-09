$ErrorActionPreference='Stop'
$target=Join-Path $PSScriptRoot 'repair-qq-gateway.ps1'
$plugin=Join-Path ([IO.Path]::GetTempPath()) ('dafeiyu-qq-test-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path (Join-Path $plugin 'src\snowluma') -Force|Out-Null
Set-Content -LiteralPath (Join-Path $plugin 'src\snowluma\manager.js') -Value '// verified-attach-v2'
Set-Content -LiteralPath (Join-Path $plugin 'src\snowluma\attach-guard.mjs') -Value '// guard fixture'
function Reset-Fixture {
  $global:qqTestposts=@();$global:qqTestcrash=$false;$global:qqTestfailAttach=$false
  $global:qqTeststate=[pscustomobject]@{config=[pscustomobject]@{gateway='snowluma';enabled=$true;dryRun=$false;botQQ='111';ownerQQ='222'};onebot=[pscustomobject]@{state='disconnected';login=[pscustomobject]@{uin=''}}}
  $global:qqTestprocesses=@([pscustomobject]@{isBot=$true;uin='111';injected=$false;connected=$false;loggedIn=$false})
}
function Invoke-RestMethod {
 param([Parameter(Position=0)][string]$Uri,[string]$Method='Get',[string]$ContentType,[string]$Body,[int]$TimeoutSec)
 if($Method -eq 'Post'){$global:qqTestposts+=$Uri}
 if($Uri.EndsWith('/state')){return $global:qqTeststate}
 if($Uri.EndsWith('/snowluma/processes')){return [pscustomobject]@{ok=$true;list=$global:qqTestprocesses}}
 if($Uri.EndsWith('/snowluma/attach')){
  if($global:qqTestfailAttach){return @{ok=$false}}
  $global:qqTestprocesses[0].injected=$true;$global:qqTestprocesses[0].connected=$true;$global:qqTestprocesses[0].loggedIn=$true;return @{ok=$true}
 }
 if($Uri.EndsWith('/onebot/reconnect')){$global:qqTeststate.onebot.state='connected';$global:qqTeststate.onebot.login.uin='111';return @{ok=$true}}
 throw 'Unexpected endpoint'
}
function Get-CimInstance {param($ClassName,$Filter);return [pscustomobject]@{CommandLine='dsh-desktop-host';CreationDate=(Get-Date).AddMinutes(1)}}
function Get-WinEvent {param($FilterHashtable,$ErrorAction);if($global:qqTestcrash){return [pscustomobject]@{Message='QQ.exe crash'}}}
function Must-Fail([scriptblock]$Action){$threw=$false;try{& $Action|Out-Null}catch{$threw=$true};if(-not $threw){throw 'Expected a safe stop'}}
function Assert($Value,$Why){if(-not $Value){throw $Why}}
$base='http://127.0.0.1:12345/aurabot/api'
Reset-Fixture
$r=(& $target -BaseUrl $base | Out-String | ConvertFrom-Json)
Assert ($global:qqTestposts.Count -eq 0) 'Read-only inspection mutated the gateway'
Reset-Fixture
$r=(& $target -BaseUrl $base -Repair -PluginDir $plugin | Out-String | ConvertFrom-Json)
Assert ($r.GatewayState -eq 'connected' -and $r.BotIdentityMatches) 'Expected verified recovery'
Assert ($global:qqTestposts.Count -eq 2) 'Recovery should attach once and reconnect once'
Reset-Fixture;$global:qqTestprocesses+= $global:qqTestprocesses[0]
Must-Fail {& $target -BaseUrl $base -Repair -PluginDir $plugin};Assert ($global:qqTestposts.Count -eq 0) 'Ambiguous identity caused mutation'
Reset-Fixture;$global:qqTestprocesses[0].isBot=$false;$global:qqTestprocesses[0].uin=''
Must-Fail {& $target -BaseUrl $base -Repair -PluginDir $plugin};Assert ($global:qqTestposts.Count -eq 0) 'Unknown identity was loaded'
Reset-Fixture;$global:qqTestcrash=$true
Must-Fail {& $target -BaseUrl $base -Repair -PluginDir $plugin};Assert ($global:qqTestposts.Count -eq 0) 'Crash protection failed'
Reset-Fixture;$global:qqTestfailAttach=$true
Must-Fail {& $target -BaseUrl $base -Repair -PluginDir $plugin};Assert ($global:qqTestposts.Count -eq 1) 'Failed attachment was repeated'
Reset-Fixture;$global:qqTeststate.config.enabled=$false
Must-Fail {& $target -BaseUrl $base -Repair -PluginDir $plugin};Assert ($global:qqTestposts.Count -eq 0) 'Disabled bot was activated'
Must-Fail {& $target -BaseUrl 'https://example.com/aurabot/api'}
Write-Output 'PASS: read-only status, one verified attach, reconnect, identity ambiguity, crash stop, no repeated injection, no unrelated activation.'
