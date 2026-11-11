$ErrorActionPreference='Stop'
$target=Join-Path $PSScriptRoot 'repair-qq-gateway.ps1'
$root=Join-Path ([IO.Path]::GetTempPath()) ('napcat-reconnect-test-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $root|Out-Null
$connection=Join-Path $root 'napcat-connection.json'
function Reset-Fixture {
  $global:qqTestposts=@();$global:qqTestlogin='11111';$global:qqTestonline=$true;$global:qqTestreconnect=$true
  $global:qqTeststate=[pscustomobject]@{config=[pscustomobject]@{gateway='onebot';enabled=$true;dryRun=$false;botQQ='11111';ownerQQ='22222';snowluma=[pscustomobject]@{httpUrl='http://127.0.0.1:13000';wsUrl='ws://127.0.0.1:13001'}};onebot=[pscustomobject]@{state='disconnected';login=[pscustomobject]@{uin=''}}}
  @{gateway='onebot';snowluma=@{httpUrl='http://127.0.0.1:13000';wsUrl='ws://127.0.0.1:13001';httpToken='fixture-not-a-real-secret';wsToken='fixture-not-a-real-secret'}}|ConvertTo-Json|Set-Content -LiteralPath $connection -Encoding utf8
}
function Invoke-RestMethod {
  param([Parameter(Position=0)][string]$Uri,[string]$Method='Get',[hashtable]$Headers,[string]$ContentType,[string]$Body,[int]$TimeoutSec)
  if($Method -eq 'Post'){$global:qqTestposts+=$Uri}
  if($Uri.EndsWith('/state')){return $global:qqTeststate}
  if($Uri.EndsWith('/get_login_info')){if($Headers.Authorization -ne 'Bearer fixture-not-a-real-secret'){throw 'Missing authentication'};return @{retcode=0;data=@{user_id=$global:qqTestlogin}}}
  if($Uri.EndsWith('/get_status')){return @{retcode=0;data=@{online=$global:qqTestonline;good=$true}}}
  if($Uri.EndsWith('/onebot/reconnect')){if(-not $global:qqTestreconnect){return @{ok=$false}};$global:qqTeststate.onebot.state='connected';$global:qqTeststate.onebot.login.uin='11111';return @{ok=$true}}
  throw 'Unexpected endpoint: no installation, injection, settings or send calls allowed'
}
function Assert($Value,$Why){if(-not $Value){throw $Why}}
function Must-Fail([scriptblock]$Action){$threw=$false;try{& $Action|Out-Null}catch{$threw=$true};if(-not $threw){throw 'Expected a safe stop'}}
$base='http://127.0.0.1:12345/aurabot/api'
try{
  Reset-Fixture
  $r=(& $target -BaseUrl $base|Out-String|ConvertFrom-Json);Assert ($global:qqTestposts.Count -eq 0) 'Inspection mutated the gateway'
  Reset-Fixture
  $r=(& $target -BaseUrl $base -Repair -ConnectionFile $connection|Out-String|ConvertFrom-Json)
  Assert ($r.BotIdentityMatches -and $r.ReconnectedByThisRun) 'Expected verified recovery'
  Assert ($global:qqTestposts.Count -eq 3 -and @($global:qqTestposts|Where-Object {$_ -like '*/onebot/reconnect'}).Count -eq 1) 'Expected two read-only OneBot actions and one reconnection'
  $global:qqTestposts=@();$r=(& $target -BaseUrl $base -Repair|Out-String|ConvertFrom-Json);Assert ($global:qqTestposts.Count -eq 0) 'Healthy connection was restarted'
  Reset-Fixture;$global:qqTestlogin='33333';Must-Fail {& $target -BaseUrl $base -Repair -ConnectionFile $connection};Assert ($global:qqTestposts.Count -eq 1) 'Wrong account reconnected'
  Reset-Fixture;$global:qqTestonline=$false;Must-Fail {& $target -BaseUrl $base -Repair -ConnectionFile $connection};Assert ($global:qqTestposts.Count -eq 2) 'Offline account reconnected'
  Reset-Fixture;$global:qqTeststate.config.snowluma.wsUrl='ws://127.0.0.1:14001';Must-Fail {& $target -BaseUrl $base -Repair -ConnectionFile $connection};Assert ($global:qqTestposts.Count -eq 0) 'Different endpoint was used'
  Reset-Fixture;$global:qqTeststate.config.enabled=$false;Must-Fail {& $target -BaseUrl $base -Repair -ConnectionFile $connection};Assert ($global:qqTestposts.Count -eq 0) 'Disabled bot activated'
  Reset-Fixture;$global:qqTestreconnect=$false;Must-Fail {& $target -BaseUrl $base -Repair -ConnectionFile $connection};Assert ($global:qqTestposts.Count -eq 3) 'Failed reconnect repeated'
  Reset-Fixture;$global:qqTeststate.config.gateway='unsupported';Must-Fail {& $target -BaseUrl $base -Repair -ConnectionFile $connection};Assert ($global:qqTestposts.Count -eq 0) 'Gateway switched implicitly'
  Must-Fail {& $target -BaseUrl 'https://example.com/aurabot/api'}
  Write-Output 'PASS: NapCat read-only status, credentials/identity/online preflight, one reconnect, healthy no-op, mismatch stops, no activation or sends.'
}finally{
  $resolved=[IO.Path]::GetFullPath($root);$expected=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if(-not $resolved.StartsWith($expected) -or (Split-Path $resolved -Leaf) -notlike 'napcat-reconnect-test-*'){throw 'Unsafe fixture cleanup path'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
