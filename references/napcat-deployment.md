# NapCatQQ 自动部署、复用与 OneBot 接入

本技能默认 QQ 网关为 NapCatQQ。仅更新技能不安装或切换当前机器的网关；用户选择部署/替换 QQ 接入后才执行下列流程。模型、音色、曲库、聊天与回复偏好保持原样。源码公开不等于任意商用或分发许可。

## 先复用，确实缺失才安装

1. 读取本机已有部署记录、用户提供的 NapCat 路径、运行进程和授权的有限目录；不扫描整盘、不输出含 Token 的命令行。已有兼容 OneBot v11 网关健康且用户没有要求替换时保留，不借更新技能切换。
2. 定位 NapCat 的实际程序目录、`config` 目录、机器人账号和 OneBot 监听端口。WebUI 端口不等于 OneBot HTTP/WS 端口；不凭文件名或单个监听端口宣布已登录。
3. 只检查时不下载、不生成 Token、不写配置、不启动 QQ。缺少信息时只问无法检测的必要路径/账号，号码和凭据仅保存在本机，不贴到对话或共享包。

## 官方来源与自动安装

- 官方仓库：<https://github.com/NapNeko/NapCatQQ>
- 当前稳定发行元数据：<https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest>
- 安装说明：<https://napneko.github.io/guide/boot/Shell>
- 网络配置：<https://napneko.github.io/config/basic>
- 许可：<https://github.com/NapNeko/NapCatQQ/blob/main/LICENSE>

执行时重新读取官方最新稳定发行信息，用户指定版本除外；不固定本例环境的版本、QQ版本或哈希。选择匹配平台的官方资产及其 `sha256` digest，记录来源、大小和校验值。`scripts/fetch-verified.py` 可作校验下载；无发布者摘要时先核对官方校验清单，不编造摘要或以自行计算的哈希冒充官方认证。解压前拒绝越界路径/软链接，放入用户指定的新目录，不覆盖已有安装或改变个人 QQ 的启动入口。

### Windows

- 已有兼容 QQ：优先审查 `NapCat.Shell.zip`，按当次文档使用实际 `launcher.bat` / `launcher-win10.bat`；原生组件与 QQ 版本仍需核对。
- 没有兼容环境或需要与个人 QQ 隔离：使用官方 `NapCat.Shell.Windows.OneKey.zip`，审查安装器后部署一份机器人专用 QQ，启动其实际生成的 `napcat.bat`。不要猜安装器的静默参数；必须本人接受的条款/账号确认交给用户，不代点。
- 下载、校验、解压、准备配置和启动命令由 Agent 执行，不要求用户逐条敲命令。启动后台辅助进程使用隐藏窗口；确需用户可见的扫码/账号窗口时明确打开对应界面。二维码由用户本人扫描；验证码、风控或封禁不绕过。
- 不同时让两个网关控制同一 QQ。替换应先备份既有连接字段，确认没有在途收发/制作任务，再停旧连接、启动指定机器人并验证。无法证明安全切换时先准备文件，不重启主号或杀进程碰运气。

### Linux / Docker

按当前官方 Shell 安装文档取得脚本并先审查，再运行对应原生或 Docker 路线；只装所选平台，不在 Windows 为此强装 Docker。容器数据持久化，端口只绑定 loopback；不同主机/容器之间另核对文件传输、挂载、鉴权及网络拓扑，不把 Windows 本地路径直接当容器路径。

## OneBot 配置与 Aurabot 兼容字段

本机默认使用 **HTTP 服务端 + 正向 WebSocket 服务端**：HTTP 调动作，WS 收事件；消息上报格式为 `array`。两者均绑定 `127.0.0.1`，使用随机强 Token，HTTP/WS/WebUI 使用互不冲突的端口。`3000/3001/6099` 只是示例，先检查占用，已有端口不抢占。WebUI 的登录令牌与 OneBot Token 是两套凭据，不混用；管理界面也限制为本机访问。

全新连接配置可由 `scripts/prepare-napcat.mjs` 生成，默认只检查：

```powershell
& '<NODE>' '<SKILL_DIR>\scripts\prepare-napcat.mjs' --config-dir '<实际NapCat配置目录>' --connection-file '<私人部署目录>\napcat-connection.json' --bot-qq '<机器人号>' --owner-qq '<主人号>' --http-port <空闲端口> --ws-port <空闲端口>
# 审核范围后追加 --apply，仅创建新的账号配置和本机连接补丁，不启动 QQ 或连接 DSH。
```

助手离线运行，不检查端口是否被占用；调用前 Agent 必须核对所选端口，Windows 私人目录沿用其访问控制，不能仅靠 POSIX 文件 mode 宣称已加密或设置 Windows ACL。

该助手拒绝覆盖不同的现有配置，不修改全局默认配置、WebUI、其它账号或网络连接；相同文件可重复执行且不换 Token。已有配置应复用，在备份后按当前 NapCat schema 精确合并，不靠此助手覆盖。先让所选发行版建立/确认实际配置目录；不能把任意创建的文件夹当已安装成功。

Aurabot 1.1.24 的通用网关入口是 `gateway="onebot"`。其 HTTP/WS 连接字段历史上仍叫 `snowluma.httpUrl/wsUrl/httpToken/wsToken`，这是**宿主兼容字段名，不代表安装或依赖旧网关**。保留字段契约，不盲改宿主源码。生成的私人连接补丁只含网关模式、端点和凭据，以及关闭旧管理器 `autoStart/autoAttach` 的字段；不改聊天开关、账号、语音、翻唱、社交或模型设置。

Agent 在当前宿主源码确认部分合并接口后，从私人连接文件读取补丁提交 `POST /aurabot/api/save`，不打印文件内容，不把脱敏 state 当完整配置回写。若宿主升级改变连接字段，先适配，不绕开认证、改源码或恢复旧管理器安装流程。修改前的真实连接凭据在本机备份，不随技能发布。

## 验证顺序与正常聊天

1. 在接入 DSH 前，向已配置的 NapCat HTTP 服务调用只读 `get_login_info`，核对账号确为用户指定机器人且不同于主人；再核对 `get_status` 的在线状态。未登录、Token错误或账号不符就停，不能用未知账号先接后查。
2. 在授权切换范围内保存连接补丁、读回网关模式与端点，再按[QQ 总开关流程](qq-and-voice.md#总开关是-qq-部署步骤不留给用户猜)配置正常回复。只更新技能/只检查不动开关。
3. 必要时只执行一次 `/onebot/reconnect`，观察 `onebot.state=connected`、`onebot.login.uin==botQQ`。进程存在、启动返回成功和 WS 握手均不是完整验收。
4. 请主人自行发送唯一测试句；分别确认入站事件、模型回复、网关接受发送和收件播放。语音、图片及翻唱成品需单独验证，不凭纯文字通了就宣称媒体全部正常。部署者不主动给第三方发消息。
5. 完成后记录实际版本/路径、许可、备份与逐链结果。是否随系统或 DSH 启动属于独立设置，按用户要求使用目标平台正式支持的服务/启动器；`gateway=onebot` 本身不会替 Agent 启动外部 NapCat，不宣称已设置自动启动。

## 已有连接断线

`scripts/aurabot.ps1 -Mode Status` 可发现实际 loopback API。`scripts/repair-qq-gateway.ps1 -BaseUrl <已发现API>` 默认只读，不启动 QQ、不重置凭据、不改设置。用户要求重连时，传 `-Repair -ConnectionFile <私人连接文件>`：验证当前使用通用 OneBot、端点一致、账号匹配且 NapCat 在线后，最多重连一次；已正常连接则不重复重连。不负责安装/重启网关，不调用旧网关管理或注入接口。

断线按“NapCat 是否启动 → 机器人是否在线 → 端口与 Token → 正向 WS 事件上报 → DSH 模型/发送结果”逐层定位。崩溃时保存必要脱敏证据，停止循环加载/重启；不关闭安全软件、不触碰主号、不删除登录数据库。`Client private-message reporting is unavailable` 必须验证真实入站事件，不能忽略。

## 分享与验收边界

技能只带我们的部署说明、配置助手和泛化测试；运行时从官方获取 NapCat，不随包附带其二进制或修改版，不将其许可证改称本仓库 CC0。个人连接 JSON、二维码、Token、账号、QQ数据和本机部署记录均不上传。

本次只完成文档迁移、生成配置/重连保护的隔离测试；没有因修改技能就在开发机安装或切换 NapCat。实际登录、收发、媒体、开机启动与另一台电脑均须在用户选择部署后逐项验证。
