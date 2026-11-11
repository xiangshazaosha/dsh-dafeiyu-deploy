[CmdletBinding()]
param(
    [ValidateSet('Status','SetVoice','TestVoice')][string]$Mode = 'Status',
    [string]$BaseUrl,
    [ValidatePattern('^[a-zA-Z0-9-]+Neural$')][string]$Voice = 'zh-CN-XiaoyiNeural',
    [ValidateRange(0,1)][double]$Chance = 1,
    [ValidateRange(1,500)][int]$MaxChars = 200,
    [string]$Text = '你好呀，我是大肥鱼。',
    [string]$OutputFile
)
$ErrorActionPreference = 'Stop'

function Assert-LocalBase([string]$Value) {
    $u = [Uri]$Value
    if (-not $u.IsAbsoluteUri -or $u.Scheme -ne 'http' -or
        $u.Host -notin @('localhost','127.0.0.1','[::1]','::1') -or
        $u.AbsolutePath.TrimEnd('/') -ne '/aurabot/api' -or $u.UserInfo -or $u.Query -or $u.Fragment) {
        throw 'Only an authorized loopback http://.../aurabot/api base is supported.'
    }
}

if (-not $BaseUrl) {
    $hosts = Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" |
        Where-Object { $_.CommandLine -match 'dsh-desktop-host' }
    foreach ($hostProcess in $hosts) {
        $ports = Get-NetTCPConnection -State Listen -OwningProcess $hostProcess.ProcessId -ErrorAction SilentlyContinue |
            Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -ExpandProperty LocalPort -Unique
        foreach ($port in $ports) {
            $candidate = "http://127.0.0.1:$port/aurabot/api"
            try {
                $probe = Invoke-RestMethod "$candidate/state" -TimeoutSec 3
                if ($null -ne $probe.onebot -and $null -ne $probe.config) { $BaseUrl = $candidate; break }
            } catch { }
        }
        if ($BaseUrl) { break }
    }
}
if (-not $BaseUrl) { throw 'No local desktop Aurabot endpoint found. Open DSH or supply its verified BaseUrl; do not bypass authentication.' }
Assert-LocalBase $BaseUrl
$BaseUrl = $BaseUrl.TrimEnd('/')
$state = Invoke-RestMethod "$BaseUrl/state" -TimeoutSec 15

if ($Mode -eq 'SetVoice') {
    $body = @{voice=@{enabled=$true;engine='edge';voice=$Voice;autoChance=$Chance;autoMaxChars=$MaxChars}} |
        ConvertTo-Json -Depth 4 -Compress
    $state = Invoke-RestMethod -Method Post -Uri "$BaseUrl/save" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 20
    if ($state.ok -eq $false) { throw 'Aurabot rejected the setting; inspect the local panel without printing credentials.' }
}

if ($Mode -eq 'TestVoice') {
    if (-not $OutputFile -or -not [IO.Path]::IsPathRooted($OutputFile)) { throw 'TestVoice needs an absolute OutputFile.' }
    if (Test-Path -LiteralPath $OutputFile) { throw 'Output already exists; choose another filename.' }
    $parent = Split-Path -Parent $OutputFile
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'Create the intended output directory first.' }
    $body = @{text=$Text} | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/voice/test" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 75
    if (-not $r.ok -or -not $r.data -or $r.engine -ne 'edge') { throw 'Edge TTS test failed or fell back to another engine; no QQ message was sent.' }
    $bytes = [Convert]::FromBase64String($r.data)
    if ($bytes.Length -lt 500) { throw 'Audio response was empty or too small.' }
    if ($r.mime -ne 'audio/mpeg' -or [IO.Path]::GetExtension($OutputFile) -ne '.mp3') { throw 'Use an .mp3 output path for this Edge response.' }
    [IO.File]::WriteAllBytes($OutputFile,$bytes)
    [pscustomobject]@{Engine=$r.engine;File=$OutputFile;Bytes=$bytes.Length;QqMessageSent=$false}
    return
}

$matchesBot = $null
if ($state.config.botQQ -and $state.onebot.login.uin) { $matchesBot = [string]$state.config.botQQ -eq [string]$state.onebot.login.uin }
[pscustomobject]@{
    BaseUrl=$BaseUrl
    GatewayState=$state.onebot.state
    LoginMatchesConfiguredBot=$matchesBot
    Enabled=$state.config.enabled
    DryRun=$state.config.dryRun
    SetupDone=$state.config.setupDone
    Workspace=$state.workspaceDir
    GatewayMode=$state.config.gateway
    EdgeInstalled=$state.voice.edgeInstalled
    VoiceEnabled=$state.config.voice.enabled
    Voice=$state.config.voice.voice
    VoiceBaseChance=$state.config.voice.autoChance
    VoiceMaxChars=$state.config.voice.autoMaxChars
    SongRoot=$state.song.root
    SongEnabled=$state.song.enabled
    SongComponentsReady=$state.song.ready
    SongVoiceCount=@($state.song.voices).Count
    SongHistoryCount=@($state.song.history).Count
    SocialBiliEnabled=$state.config.bili.enabled
    SocialDouyinEnabled=$state.config.douyin.enabled
    EndToEndChatVerifiedByThisScript=$false
} | ConvertTo-Json -Depth 3
