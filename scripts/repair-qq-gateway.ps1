[CmdletBinding()]
param([Parameter(Mandatory)][string]$BaseUrl,[switch]$Repair,[string]$PluginDir)
$ErrorActionPreference='Stop'
$u=[Uri]$BaseUrl
if(-not $u.IsAbsoluteUri -or $u.Scheme -ne 'http' -or $u.Host -notin @('localhost','127.0.0.1','[::1]','::1') -or $u.AbsolutePath.TrimEnd('/') -ne '/aurabot/api' -or $u.UserInfo -or $u.Query -or $u.Fragment){throw 'Use the verified local DSH Aurabot API, not an arbitrary URL.'}
$BaseUrl=$BaseUrl.TrimEnd('/')
function Read-State { Invoke-RestMethod "$BaseUrl/state" -TimeoutSec 15 }
function Read-Processes {
  $p=Invoke-RestMethod "$BaseUrl/snowluma/processes" -TimeoutSec 25
  if(-not $p.ok){throw 'Cannot authenticate/read SnowLuma processes; do not reset credentials or inject.'}
  return @($p.list)
}
function Matches-Bot($s){return [bool]($s.onebot.login.uin -and ([string]$s.onebot.login.uin -eq [string]$s.config.botQQ))}
$state=Read-State
if($state.config.gateway -ne 'snowluma'){throw 'This helper only diagnoses an existing SnowLuma gateway.'}
$processes=Read-Processes
$bot=@($processes|Where-Object {$_.isBot -and [string]$_.uin -eq [string]$state.config.botQQ})
$attached=$false
if($Repair){
  if(-not $state.config.enabled){throw 'Aurabot is disabled; do not enable unrelated behavior in a gateway-only repair.'}
  if(-not $state.config.botQQ -or [string]$state.config.botQQ -eq [string]$state.config.ownerQQ){throw 'The bot and owner identities must be distinct.'}
  if($bot.Count -ne 1){throw 'No unique pre-verified bot process; leave other and unknown QQ accounts untouched.'}
  if($state.onebot.state -eq 'connected' -and -not (Matches-Bot $state)){throw 'Connected account mismatch; stop and inspect, do not reconnect blindly.'}
  if(-not ($bot[0].injected -and $bot[0].connected -and $bot[0].loggedIn)){
    if(-not $PluginDir){throw 'Specify the installed PluginDir to verify the loaded attach guard before repair.'}
    $manager=Join-Path $PluginDir 'src\snowluma\manager.js'
    $guard=Join-Path $PluginDir 'src\snowluma\attach-guard.mjs'
    if(-not (Test-Path -LiteralPath $guard) -or -not (Get-Content -Raw -LiteralPath $manager).Contains('verified-attach-v2')){throw 'A verified attach guard is required; review and apply the supported guard first.'}
    $hosts=@(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" | Where-Object {$_.CommandLine -match 'dsh-desktop-host'})
    $modified=@((Get-Item -LiteralPath $manager).LastWriteTime,(Get-Item -LiteralPath $guard).LastWriteTime)|Sort-Object -Descending|Select-Object -First 1
    if($hosts.Count -ne 1 -or $hosts[0].CreationDate -lt $modified){throw 'Cannot prove the guard was loaded by this DSH host; verify/reload it before attaching.'}
    try{$crashes=@(Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=(Get-Date).AddHours(-2);Id=1000,1001} -ErrorAction Stop | Where-Object {$_.Message -match 'QQ.exe|SnowLuma'})}
    catch{if($_.FullyQualifiedErrorId -notmatch 'NoMatchingEventsFound'){throw 'Cannot inspect crash history; review it manually before loading.'};$crashes=@()}
    if($crashes.Count){throw 'Recent QQ/SnowLuma crash evidence exists; diagnose it instead of retrying injection.'}
    $r=Invoke-RestMethod -Method Post -Uri "$BaseUrl/snowluma/attach" -ContentType 'application/json' -Body '{}' -TimeoutSec 35
    if(-not $r.ok){throw 'Attach was not verified; stop here, do not repeat loading.'}
    $attached=$true
    $processes=Read-Processes
    $bot=@($processes|Where-Object {$_.isBot -and [string]$_.uin -eq [string]$state.config.botQQ})
    if($bot.Count -ne 1 -or -not ($bot[0].injected -and $bot[0].connected -and $bot[0].loggedIn)){throw 'The load response did not produce one verified online bot; do not retry.'}
  }
  $r=Invoke-RestMethod -Method Post -Uri "$BaseUrl/onebot/reconnect" -ContentType 'application/json' -Body '{}' -TimeoutSec 20
  if(-not $r.ok){throw 'Bot attached, but OneBot reconnection did not pass; inspect endpoint/authentication without reloading QQ.'}
  $state=Read-State
  if($state.onebot.state -ne 'connected' -or -not (Matches-Bot $state)){throw 'Reconnection did not pass identity verification.'}
}
[pscustomobject]@{RepairRequested=[bool]$Repair;GatewayState=$state.onebot.state;BotIdentityMatches=(Matches-Bot $state);UniqueBotProcess=($bot.Count -eq 1);BotOnline=($bot.Count -eq 1 -and $bot[0].injected -and $bot[0].connected -and $bot[0].loggedIn);AttachedByThisRun=$attached;Enabled=$state.config.enabled;DryRun=$state.config.dryRun;ConfigurationChanged=$false;TestMessageSent=$false;EndToEndDeliveryVerified=$false}|ConvertTo-Json
