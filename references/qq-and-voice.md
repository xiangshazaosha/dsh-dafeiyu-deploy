# QQ 与在线语音

只读所选部分：QQ已正常时沿用网关、账号与开关，不重新扫码/安装；只配本机TTS不要求QQ在线。下列首次部署的关闭/登录步骤不用于重置已工作的账号。修改已有自动回复行为须符合本次范围，测试外发单独确认。

## 网关、许可与账号

首次安装、重装/复用独立 SnowLuma、被要求反复改密码/进网页加载，或加载 QQ 导致退出时，先读[SnowLuma 安装复用与加载故障](snowluma-setup-and-reuse.md)。预检可运行 `scripts/find-snowluma.ps1`，即使 Aurabot 尚未安装也先定位已有网关；发现候选不等于已认证或可正常接入。

链路：QQ小号进程 ⇄ SnowLuma/已有OneBot v11 ⇄ Aurabot ⇄ DSH模型。
SnowLuma官方发布页：<https://github.com/SnowLuma/SnowLuma/releases/latest>。
未找到 SnowLuma 时，仅告知：“由于许可协议问题本项目无权提供自动部署，请自行安装，完成后告诉我目录”。继续其他独立项目；用户提供目录后检查并接入已有安装。也可接入用户已有的兼容 OneBot v11 服务。

1. 主人QQ与机器人QQ不同，用户在面板填；不把号码、Token打印到报告。
2. 用户登录机器人小号。退出登录/结束QQ进程会断线，关窗后台保活视实际客户端而定，需测试。
3. `snowluma.dir`填用户目录，直接有`index.mjs`。按Aurabot管理启停，不起多个副本。
4. 由用户完成必要条款及扫码。正常 QQ 聊天部署完成后 `dryRun=false`；日记、主动搭话、空间、B站/抖音互动先关，群聊按需。用户明确要求试运行或静默时遵从其选择。
5. 接入后核对`onebot.login.uin == botQQ`，不注入主人主号，多个未知进程不猜。优先Aurabot自带核对与attach逻辑。
6. WS connected只证明握手。正常聊天部署按已选目标开启真实回复；请主人自行发唯一测试句，查接收、模型生成、发送和主人收件，不擅自发其他测试消息。

### 总开关是 QQ 部署步骤，不留给用户猜

用户选择首次部署/重装 QQ 聊天，已包含在下列条件满足后由 Agent 打开 AuraBot 总开关并关闭试运行，以便正常回复；不默认要求用户自己找按钮或再单独授权关闭试运行。只检查、只装桌宠、只配本机 TTS/RVC 不开启；用户明确要求试运行/静默则遵从，已正常工作的 QQ 保持现有设置。

1. 先保存并核对网关目录/地址、管理认证、协议状态、主人号与机器人号不同、指定机器人 QQ 可供接入；在不触发回复的前置检查中通过网关登录信息核对机器人身份，按[加载故障与自动防护](snowluma-setup-and-reuse.md)检查异步加载验收能力。账号未明、认证失败或已知加载崩溃未修复时暂停，不注入主号。
2. 在当前版本已核实的部分保存接口中，同时设置 `dryRun=false`、`enabled=true`，以正常回复模式运行；仅用户明确要求试运行时设置 `dryRun=true`。不得打开全 QQ 自动注入。新部署中主动外发/社交先关闭；可能产生的模型调用和费用按实际情况说明。
3. 立即重新读取状态，正常模式确认 `config.enabled=true` 且 `config.dryRun=false`；不能只凭 HTTP 成功宣布已开启。如果保存或读回失败，停止后续接入并报错，不继续改其他字段。随后观察连接并再次核对 `onebot.login.uin == botQQ`。若当前版本无法在开启 AuraBot 前检查网关身份，不要为了避免死锁而接入身份未知的个人 QQ；报告具体阻塞。
4. 向导完成状态按当前支持接口与实际条件提交、读回，不直接写 `setupDone=true` 伪造验收。总开关开着但未连接，分别报告“开关已开启/连接未完成”与原因；出现账号不符或加载崩溃时停止相应自动重试，报告故障保护下的开关状态。
5. 最终必须报出总开关、试运行、机器人身份核对和连接四项状态；正常聊天目标下不得遗留未说明的试运行。只有实际收发测试通过才可报告“可用”；主人自行发送测试消息，部署者不主动向第三方发消息。

这是对连接总开关的部署授权，不是对真实发消息、空间/B站/抖音互动或任意接入个人主号的授权。

`Client private-message reporting is unavailable`告警不能忽略：用真实测试定位QQ/SnowLuma版本和事件上报，不把“connected”当全部通。有限重试，不反复注入、抓凭据、关闭安全软件或盲目重装。

## 本机API（当前版本需核对源码）

桌面Host本地动态端口下`/aurabot/api`，不是固定3000或5099。
- `GET /state`可能含个人配置，不能整包打印/打包。
- `POST /save`先确认`mergeFromPanel`支持部分合并；不用旧state覆盖新设置。
- `POST /voice/test`本机生成音频，响应`data`是base64，只解码存文件。
- 该测试路由是`/voice/test`，不是`/ext/voice/voice/test`。
- SnowLuma协议/启动接口受到人工与许可边界约束；随包助手不会调用它们。

用`scripts/aurabot.ps1 -Mode Status`发现当前DSH进程的loopback端口；也可显式传`-BaseUrl`。不扫描网络，不绕宿主认证，返回字段脱敏。

## 先选说话方案，不捆绑唱歌

本机 Breeze TTS 2（第三方 C++/Vulkan）部署、原创音色与实验转换见 [Breeze](breeze-tts2-cpp.md)。讲话/RVC 切换、当前版本隐藏表单的原因以及真正的仅文字/仅语音/双发/自动模式见[独立控制页](voice-controls.md)；不要只让用户找不存在的旧按钮。

先读 [电脑配置与语音方案选择](hardware-and-voice.md)。已有好用引擎默认沿用；本地角色语音是可选增强，不是 RVC 翻唱的前置。用户只想自然地读聊天消息且接受联网时，可优先建议较轻的 Edge；明确要离线或固定角色声音时再评估本地引擎。CosyVoice/GPT-SoVITS 的引擎能运行，不等于当前 Aurabot 已支持其接口，接适配器并测试后才算接通。用户不接受联网时不能自动改 Edge。

本地部署失败或太慢：先解释原因并保留已工作配置，提供 Edge/用户已有兼容远端服务/暂用文字的选择；经用户选择才改说话引擎，不动 RVC 音色、歌曲库、点歌源。Edge 失败也不能默默退回 Windows 机械音后宣布自然 TTS 成功。唱歌失败不能靠切换 TTS 解决。

## Edge TTS

<https://github.com/rany2/edge-tts> 是第三方客户端，调用微软Edge在线语音服务；不是大肥鱼专属模型，也不是Azure官方商业API集成。朗读文字会发给在线服务，需向用户说明联网与数据流。其他在线服务先核对费用、条款和兼容接口，不承诺永久免费稳定。

独立环境：`<ROOT>/Aurabot/voice`。复用可信uv/Python，不污染系统。已有环境先检测，不覆盖：

```powershell
$env:UV_CACHE_DIR='<ROOT>\Aurabot\voice-cache'
& '<uv.exe>' venv '<ROOT>\Aurabot\voice' --python '<可用Python>'
& '<uv.exe>' pip install --python '<ROOT>\Aurabot\voice\Scripts\python.exe' edge-tts
& '<ROOT>\Aurabot\voice\Scripts\python.exe' -I -m edge_tts --list-voices
```

启动DSH前设置`AURABOT_PYENV`。`edgeSynth`应通过`-I`或隔离子进程环境避免全局PYTHONPATH污染。`edgeInstalled`只是文件检测，调用`/voice/test`确认`engine=edge`，避免默默退到Windows机械音。

实时查询声音ID，再给同一句话试听：晓伊`zh-CN-XiaoyiNeural`、晓晓`zh-CN-XiaoxiaoNeural`、晓北`zh-CN-liaoning-XiaobeiNeural`（辽宁口音）。用户选，不把本次选择硬当全体默认。

```powershell
./scripts/aurabot.ps1 -Mode SetVoice -Voice zh-CN-liaoning-XiaobeiNeural -Chance 1 -MaxChars 200
./scripts/aurabot.ps1 -Mode TestVoice -Text '你好呀，我是大肥鱼。' -OutputFile '<绝对输出路径>.mp3'
```

助手不改变dryRun、不发QQ、不启动社交。`Chance=1`不等于每条必语音：还受心情乘数、长度、服务失败影响。QQ里明确说“用语音回复我”“发个语音给我”走`wantsVoice`；仍要语音开启、合成与QQ发送正常。“不要语音”需尊重。用户要强制全语音，先核验实现并说明长文本/群聊刷屏取舍，不把概率调整称为强制。

验收分层：组件安装→本机真TTS→QQ主人请求→模型完成→QQ语音发送成功→用户能播放。未实测的层不得写成功。
