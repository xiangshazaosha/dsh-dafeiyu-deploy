# Breeze CPP / RVC 翻唱制作与清唱

部署 `.breeze` 实验翻唱、统一 QQ 点歌引擎、清唱/伴奏或本机试听时读取。随包是可安装用户模块源码，不是只有提示词；Breeze 唱歌仍属实验功能，不承诺旋律保真。

## 当前界面：一处设置，一处制作

- **系统→音色切换→翻唱·统一设置**：唯一声音设置入口。选择引擎、该引擎的具体音色、清唱/伴奏、Breeze 保留旋律或 RVC 变调，以及 QQ 默认片段长度。只显示当前引擎的参数，另一引擎的备用值保留，不代表一起运行。
- **系统→翻唱制作**：原“Breeze翻唱”菜单的新名字。只读统一声音摘要；选歌曲、片段起点、单次长度及歌词，制作/试听、查看 QQ 请求实际来源/引擎/音色和发送结果。不再另存一套声音参数。
- “已翻唱成品”按钮立即保存：开启时只复用符合当前引擎和音色等参数的成品；关闭后重新换声，但保留人声/伴奏分离缓存。它不是本地原曲开关。具体路径、索引和故障处理见[统一路由与复用](cover-routing-and-reuse.md)。
- 普通聊天讲话音色、回复方式与翻唱分开保存。安装或保存设置不启动制作，不向 QQ 试发。

## 源码与前置

`assets/breeze-cover/` 包含 `index.mjs`、`studio.mjs`、`saved-profile.mjs`、`qq-router.mjs`、`local-sources.mjs`、`folder-library.mjs`、`panel.js` 和 `separate.py`。复制时不得漏掉新依赖；`scripts/install-voice-module.mjs --module breeze-cover` 已使用白名单完整安装，默认只检查。

复用实际 FFmpeg、Python 分离环境、BS-RoFormer 权重/配置、Breeze CPP 或 RVC 服务，不修改包管理器共享的 Aurabot 核心代码。本包不含这些环境、模型、歌曲、成品、索引、参考音频或私人声音。

本轮统一路由在 Aurabot 1.1.24 / 模块 API 1 验证。已有环境保持复用；更换宿主版本先检查实际对象引用及接口，不用历史版本号强制降级。需要 `api.on/every/command/onDispose/use/lib/route/tool/rule`、`core.http.raw/query/send`，以及 `song.request/search/status/convertSpeech` 等真实契约。新的制作/工具入口必须重新验证是否经过同一个 request 包装。

## 按需安装或升级

1. 找到真实插件、数据根、工作区和本机 API。用 `scripts/aurabot.ps1 -Mode Status` 等只读手段，不固定开发机盘符、用户名或端口，不打印整份配置。
2. 查看原生 RVC 的 current/queue、翻唱制作 busy，以及 QQ active。制作、发送或异步清唱导出尚未结束时等待安全节点，不靠重启停止任务。
3. 检查已有用户模块及私有修改，备份后再替换。只加本机制作可选 `breeze-cover`、`voice-controls`；如果已有/选择成品库，也同步审查兼容版 `song-library`，避免旧缓存监听抢答。主人私聊适配可能缩小旧 `/sing` 的群聊功能，需保留/另适配用户原有权限，不静默改变。
4. 各模块先运行安装器 check-only；确认范围后才 `--apply`。已有不同源码要求 `--replace --backup-dir <新目录>`，不能把该选项当跳过审查的手段。入口文件最后替换，仅重载目标模块，不动 DSH/QQ、总开关、自动互动或账号。
5. 核对三个模块状态、菜单、统一 profile、路由 guardInstalled。按[统一路由参考](cover-routing-and-reuse.md)做只读预览和隔离测试；用户主动点歌的生产任务才可完成后提交其指定版本。

安装入口不重置已有选择。全新部署只选了Breeze翻唱时，要在用户所选范围内明确保存 `engine=breeze` 和可用音色并读回；不能依赖为兼容旧用户而保留的RVC默认值，装完却把QQ交给另一引擎。

## 真正的制作链

原曲→截取片段→分离人声/伴奏→当前引擎换声→导出清唱及带伴奏。清唱只含转换后人声；另一个文件才混入伴奏。一个任务保留两份文件不代表两种引擎一起跑。

当前通用分离脚本使用本机 audio-separator / BS-RoFormer CPU 路线，Breeze CPP 的 Vulkan 只加速后续换声。不要把“Breeze 用显卡”等同于全链 GPU。NVIDIA CUDA 或其它分离后端须按目标环境单独安装和实测，不能只改文案就声称加速。同原曲、起点、长度及模型未变化时，验证过的人声/伴奏缓存可跨音色复用。

支持 1–180 秒片段，先做 10 秒本机试听。QQ 默认时长与本机单次时长分开；不能用短片段冒充整首。Breeze `keepMelody=0/1/2` 保留不同数量的原音频声学信息，不是越大必然越好，可能保留原唱声音；歌词可帮助咬字，但不保证唱腔保真。RVC 的变调只对 RVC 有效。

本机制作使用 `breeze_cover_create`，不会自动发 QQ；QQ 点歌使用 `qq_song_cover`，已经按统一引擎分流。不得同一请求再调用另一制作工具或旧脚本。Breeze 未就绪/失败就报告，不改发 RVC 或旧库成品；实际结果看任务 engine/voice/backend。QQ 任务自带单次提交，不能再手动 send 一遍。

网易云普通点歌是原唱优先，不要求必须找到原唱本人录音；可用其它同名演唱来源制作，但不得冒称原唱。明确版本要求、完整音频可用性与非演唱来源过滤见[统一路由参考](cover-routing-and-reuse.md#网易云自动选版本)。RVC未指定变调时沿用面板，不因男女声音擅自升降八度。

## 验收与回退

运行 `node --test scripts/test-breeze-cover.mjs scripts/test-cover-*.mjs scripts/test-song-library.mjs scripts/test-install-voice-module.mjs`。离线默认不调用任何真实账号、网络、模型或宿主；真实已安装 `qq_song_cover` 的隔离契约测试需显式设置 `DSH_AURABOT_PLUGIN_DIR` 为已审查的插件目录，仍使用临时数据和模拟网关，不做真实发送。

源码/API、静态组件渲染、真实音频生成、QQ 提交与收件人播放是不同验收层。开发机已验证真实短片段及本地原曲的 60 秒 Breeze 制作/提交，但收件播放、主观音色和另一台机器仍须分别确认；不随包带测试歌曲。

停用/回退只恢复所选模块的备份并重载，保留配置、导入原曲、成品、私人声音和索引。`qq-requests.json` 中在途任务重载后不自动重做或重发；规则升级失效的旧候选应重新点歌，确需继续必须由主人明确要求，不能以部署为由恢复旧外发任务。
