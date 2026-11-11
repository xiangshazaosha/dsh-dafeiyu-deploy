[CmdletBinding()]
param([Parameter(Mandatory)][string]$BaseUrl,[switch]$Repair,[string]$ConnectionFile)
$ErrorActionPreference='Stop'
function Assert-LocalUrl([string]$Value,[string]$Scheme) {
  $u=[Uri]$Value
  if(-not $u.IsAbsoluteUri -or $u.Scheme -ne $Scheme -or $u.Host -notin @('localhost','127.0.0.1','[::1]','::1') -or $u.UserInfo -or $u.Query -or $u.Fragment){throw 'Use a verified loopback endpoint without credentials in its URL.'}
  return $u
}
$api=Assert-LocalUrl $BaseUrl 'http'
if($api.AbsolutePath.TrimEnd('/') -ne '/aurabot/api'){throw 'Use the verified local Aurabot API.'}
$BaseUrl=$BaseUrl.TrimEnd('/')
function Read-State { Invoke-RestMethod "$BaseUrl/state" -TimeoutSec 15 }
function Matches-Bot($s){return [bool]($s.onebot.login.uin -and ([string]$s.onebot.login.uin -eq [string]$s.config.botQQ))}
$state=Read-State
if($state.config.gateway -ne 'onebot'){throw 'This helper only handles generic OneBot connections; it never switches the gateway.'}
$reconnected=$false
if($Repair){
  if(-not $state.config.enabled){throw 'Aurabot is disabled; do not activate it in a gateway-only repair.'}
  if(-not $state.config.botQQ -or [string]$state.config.botQQ -eq [string]$state.config.ownerQQ){throw 'Bot and owner identities must be distinct.'}
  if($state.onebot.state -eq 'connected'){
    if(-not (Matches-Bot $state)){throw 'Connected account mismatch; no reconnection attempted.'}
  }else{
    if(-not $ConnectionFile -or -not [IO.Path]::IsPathRooted($ConnectionFile) -or -not (Test-Path -LiteralPath $ConnectionFile -PathType Leaf)){throw 'Provide the private NapCat connection patch for read-only identity checks.'}
    $patch=Get-Content -LiteralPath $ConnectionFile -Raw|ConvertFrom-Json
    if($patch.gateway -ne 'onebot'){throw 'Invalid private OneBot patch.'}
    # Host API 1.1.24 retains this compatibility key for generic endpoints.
    $ep=$patch.snowluma;$current=$state.config.snowluma
    $null=Assert-LocalUrl $ep.httpUrl 'http';$null=Assert-LocalUrl $ep.wsUrl 'ws'
    if($ep.httpUrl.TrimEnd('/') -ne $current.httpUrl.TrimEnd('/') -or $ep.wsUrl.TrimEnd('/') -ne $current.wsUrl.TrimEnd('/')){throw 'Private patch and active endpoints differ; no configuration was changed.'}
    if(-not $ep.httpToken -or [string]$ep.httpToken -ne [string]$ep.wsToken){throw 'Expected the prepared matching OneBot credentials; no reset attempted.'}
    $headers=@{Authorization='Bearer '+$ep.httpToken}
    $login=Invoke-RestMethod ($ep.httpUrl.TrimEnd('/')+'/get_login_info') -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 15
    if($login.retcode -ne 0 -or [string]$login.data.user_id -ne [string]$state.config.botQQ){throw 'NapCat login identity is unavailable or does not match the bot; no reconnection attempted.'}
    $online=Invoke-RestMethod ($ep.httpUrl.TrimEnd('/')+'/get_status') -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 15
    if($online.retcode -ne 0 -or $online.data.online -ne $true -or $online.data.good -eq $false){throw 'NapCat is not online; complete its login without restarting other accounts.'}
    $r=Invoke-RestMethod -Method Post -Uri "$BaseUrl/onebot/reconnect" -ContentType 'application/json' -Body '{}' -TimeoutSec 20
    if(-not $r.ok){throw 'OneBot reconnection failed; do not repeat automatically.'}
    $reconnected=$true;$state=Read-State
    if($state.onebot.state -ne 'connected' -or -not (Matches-Bot $state)){throw 'Reconnection did not pass account verification; no retry performed.'}
  }
}
[pscustomobject]@{RepairRequested=[bool]$Repair;GatewayState=$state.onebot.state;BotIdentityMatches=(Matches-Bot $state);ReconnectedByThisRun=$reconnected;Enabled=$state.config.enabled;DryRun=$state.config.dryRun;ConfigurationChanged=$false;QqStarted=$false;TestMessageSent=$false;EndToEndDeliveryVerified=$false}|ConvertTo-Json
