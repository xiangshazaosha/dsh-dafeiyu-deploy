# QQ 与在线语音

只读所选部分：QQ 已正常时沿用网关、账号与开关，不重新扫码/安装；只配本机 TTS 不要求 QQ 在线。修改技能不自动迁移运行中的网关。

## 网关、许可与账号

链路：机器人专用 QQ ⇄ NapCatQQ（OneBot v11）⇄ Aurabot ⇄ DSH 模型。默认网关的下载校验、安装、配置、复用与断线处理读[NapCatQQ 自动部署](napcat-deployment.md)。已有兼容服务优先复用；本次选择新建/替换 QQ 接入时才部署，不顺带更换语音、翻唱或曲库。

1. 主人号与机器人号必须不同，只接用户指定的机器人；未知账号不猜，不打印号码、Token或整份配置。
2. 安装与配置由 Agent 完成，扫码、验证码和必须本人接受的条款由用户处理。遇风控/崩溃暂停，不绕过、不反复重启主号。
3. 使用 loopback HTTP + 正向 WS，独立管理 NapCat，不启动宿主旧网关管理器。WebUI 令牌与 OneBot Token 分开。
4. 先调用网关只读 get_login_info/get_status 验证机器人及在线，再接入 Aurabot 的通用 OneBot 模式。
5. WS connected 只证明连接；请主人自行发送唯一测试句，核对入站、模型生成、发送与收件，语音/图片另验。不主动向第三方试发。

### 总开关是 QQ 部署步骤，不留给用户猜

用户选择首次部署/重装 QQ 聊天时，在下列检查通过后由 Agent 开启正常回复；只检查、只装桌宠、只配本机 TTS/RVC 不开启。已有 QQ 正常时保持现有设置；明确试运行/静默时遵从。

1. 保存并核对 OneBot 端点与认证，通过网关 get_login_info 验证机器人身份且不同于主人。未登录、账号不符、认证失败或崩溃未解决就停，不先接入未知账号。
2. 用当前宿主已核实的部分保存接口设置 `gateway="onebot"` 和连接字段，读回端点；正常聊天部署再设置 `enabled=true`、`dryRun=false`。不打开主动搭话、群发、日记发布或社交互动；模型调用费用按实际情况说明。
3. 读回开关、试运行和 `onebot.state=connected`、`onebot.login.uin==botQQ`，不凭 HTTP 成功或启动退出码声称接通。若当前版本不能在开关前验证身份，报告具体阻塞，不绕过。
4. setupDone 依实际向导/支持接口完成，不写死为 true 伪造验收。开关已开但未连接时明确报告两项状态。
5. 请主人发测试句并确认收件；分别报告开关、试运行、身份与连接，只有真实收发通过才说聊天可用。正常聊天部署不授权主动给第三方发消息或社交互动。

## 本机 API（当前版本需核对源码）

DSH Host 的 `/aurabot/api` 端口动态发现，不是 NapCat 的 HTTP/WS/WebUI 端口。
- `GET /state` 可能含个人配置，不整包打印或打包。
- `POST /save` 先确认部分合并契约，不用脱敏 state 覆盖配置；OneBot 的宿主兼容字段见[NapCat流程](napcat-deployment.md#onebot-配置与-aurabot-兼容字段)。
- `POST /onebot/reconnect` 只在明确修复范围内、身份/端点已核对后单次调用，不循环重连。
- `POST /voice/test` 本机生成音频，响应 data 为 base64，只解码到私人输出目录，不发送 QQ；不是 `/ext/voice/voice/test`。
- `scripts/aurabot.ps1 -Mode Status` 发现当前 Host loopback 端口，也可给已核实的 `-BaseUrl`，不扫描网络或绕宿主认证。

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
