# Breeze CPP / RVC 本机翻唱与清唱选择

用户要求用 `.breeze` 音色唱已有歌曲、把分离/换声/混音固化为插件，或给 Breeze、RVC 增加清唱按钮时读取。这是随包提供的独立用户扩展，不是声称 Breeze 官方保证唱歌保真。只部署本次选择的部分。

## 随包有什么

- `assets/breeze-cover/{index.mjs,studio.mjs,panel.js,separate.py}`：实际可安装源码，不只是提示词。复用本机 FFmpeg、CPU 分离环境、已安装 Breeze CPP 或 RVC；不改 Aurabot 核心文件。
- `assets/voice-controls/`：更新后的音色页，讲话、Breeze翻唱、RVC翻唱各自保存；两个引擎分别选择清唱/带伴奏。
- `assets/song-library/`：可选的成品优先扩展更新，使主人私聊原生 RVC 请求继承清唱默认值，明确指定版本优先。不要为装翻唱面板而强制安装它、缩小原来的群聊/非主人权限；见[成品库](song-library.md)。
- 既有[固定音色包](breeze-saved-presets.md)仍按需导入实际 `.breeze`。不打包歌曲、分离后人声、参考录音、成品、个人设置、账号或基础权重；也不打包额外的讲话轮换功能。

## 前置检查与最小安装

1. 发现实际插件、数据、工作区及当前 API 地址；可用 `scripts/aurabot.ps1 -Mode Status`，不要固定 D 盘、用户名或开发时端口。只读提取所需字段，不输出整个配置。已有模块先识别与备份，正在制作/发送时先等安全节点，不重启 DSH 或 QQ。
2. 检查当前模块 API 1：`lib/config/settings/saveSettings/route/onDispose/use/tool/rule`；`core/http` 有 `raw/query/send`；`core/store` 有 `dataDir`；`song/netease.songUrl` 仍返回 `{url,trial}`。检查内置 song 模块实际导出 `status/search/convertSpeech`，后者接受 `(wav,{voice,pitch,outDir})` 并返回本机文件，不调用 `request` 自动发送。已验证 Aurabot 1.1.24；不兼容时停止安装并适配，不绕过宿主安全模式。
3. 两种引擎都需要实际 `config.song.root` 下的 `bin/ffmpeg.exe`、`env/Scripts/python.exe`、`separator-models/<song.separatorModel>` 及同名 YAML；依赖包含 torch 与 audio-separator。只在缺失且用户选择该功能时按[CPU准备](rvc-cpu.md)补齐分离环境及其依赖，解释体积/后端/许可，不为了 Breeze 换声默认下载五款 RVC 模型。分离工作进程使用 `-I`，不从未知项目目录导入 Python 包，不自动下载缺失模型。
4. Breeze 路线按[CPP语音](breeze-tts2-cpp.md)复用已核对运行时，`ext.voice.breezeRoot` 指向实际根，`breeze-runtime.json.sourceRoots` 必须允许实际 `<Aurabot数据>/songs`，才能把本插件分离的人声交给转换服务；仅添加此必要目录，保留其余设置，不开放整盘。加载随包可配置的 `breeze-voice`，核对 `breezeVoices/breezeConvert`；不从开发机器复制其私人语音模块。RVC 路线则复用已校验的选定权重。Breeze 的 `.breeze` 不改后缀冒充 RVC `.pth`。
5. 执行隔离测试 `node --test scripts/test-breeze-cover.mjs scripts/test-install-voice-module.mjs scripts/test-song-library.mjs`，另运行 `node scripts/test-voice-controls.mjs`。Python 用可用解释器 `ast.parse` 检查 `assets/breeze-cover/separate.py`，不导入 torch 或触发模型下载。可临时设置环境变量 `DSH_SONG_TEST_FFMPEG=<已安装ffmpeg>` 启用歌曲库合成测试音验证，测后移除该变量；默认不碰 QQ、歌曲和模型。
6. 由 Agent 运行安装器（尖括号替换为实际绝对路径，以下默认只检查）：

   ```text
   node scripts/install-voice-module.mjs --plugin-dir <插件目录> --data-dir <数据目录> --module breeze-cover
   node scripts/install-voice-module.mjs --plugin-dir <插件目录> --data-dir <数据目录> --module voice-controls
   ```

   通过后分别加 `--apply`。已有不同自定义文件先审查，需要替换才加 `--replace --backup-dir <新的模块外备份目录>`；不要直接覆盖。选择既有成品库适配时再以同样方法安装 `--module song-library`。安装器不写用户配置、不下载模型、不启动服务、不发送QQ。
7. 通过实际 API 的 `/modules/reload` 仅加载新增/更新的目标模块，检查 `running=user,error=''`，独立面板 `builtin=false,panel=true`。不要为显示按钮重启网关。核对 `/ext/breeze-cover/state` 的 `ready/rvcReady`、真实音色列表、两个版本设置；未准备的引擎明确不可用。首次制作先选列表内的具体音色；若未导入默认撒娇预设就选已有音色，不自动下载或重生成全部声音。

## 可见入口及真实行为

Aurabot 1.1.24 验证入口：**DSH → Aurabot → 系统 → 音色切换**；Breeze 实验翻唱卡和 RVC 卡各有输出版本选择，保存互不串改讲话/回复方式。制作入口：**系统 → Breeze翻唱**，支持引擎、具体音色、清唱/带伴奏、导入本机文件/已有缓存/网易云候选、起点和时长。版本不同以实际导航证据为准。静态组件渲染和 API 测试不是已经目视操作过屏幕。

流程：歌曲片段 → CPU分离 → Breeze CPP 或选定RVC换声 → 对齐长度 → 导出两个版本。清唱 MP3 只输入换声后人声，带伴奏 MP3 才输入伴奏；分离残留可能仍有少量伴奏，不承诺零串音。两个文件独立保留，可分别本机播放，不能仅把混音改名成清唱。输出约 -16 LUFS / -1.5 dBTP，仍需试听质量。

- 目前只支持 **1–180秒片段**，默认10秒。不是已完成任意长整曲支持；导入最多64MB，下载最多60MB。网易云只使用现有授权来源，拒绝试听/无权限音源，不代替用户选定同名版本。
- Breeze `keepMelody` 为0/1/2，可填对应片段歌词改善咬字。先短片段试听；1/2可能多保留原声特点，不能把保留旋律开关说成必定保真，也不能把TTS读歌词当唱歌。
- 一次处理一项，最多排队三项；同源同音色/参数复用完成文件。取消会停止自有处理子进程，Breeze转换调用可能需等待返回；不终止共享语音服务。中断任务重载后不自动重跑。分离缓存复用不等于允许更换源后复用错误人声。
- 本机制作默认**不发送QQ**。两个音频播放器各有显式发送按钮并要求确认。QQ未连接时保留本机试听，不擅自修复/重连；发送另验收。保持当前声音、回复模式、QQ总开关、试运行和社交设置。
- RVC默认版本保存于 `ext['breeze-cover'].rvcArrangement`；本机面板和本插件工具直接使用它。原生 `/sing` / `qq_song_cover` 继承此默认需要选择并加载匹配的 `song-library` 更新，仅主人私聊受其保护；明确“带伴奏/清唱”覆盖默认。未安装该适配就如实说明原生入口不会自动继承，不假称只存了设置就全局生效。
- 本插件成品位于实际 `<数据>/songs/breeze-cover/jobs/<id>`，任务索引位于 `<数据>/modules-data/breeze-cover`，导入文件也在后者。不是自动加入持久成品库；不把这些输出再次列为“原曲缓存”。

## 给 DSH 的工具与简短说法

随包模块通过 `api.tool` 注册主人私聊工具（仅 `level=full` 且实际轮次主人校验通过）；未在当前宿主出现时先查模块加载/工具权限，不只贴提示词假称已接通：

1. `breeze_cover_sources`：无 query 列本机来源和音色；有 query 搜歌曲候选，不制作。
2. `breeze_cover_create`：`engine=breeze|rvc`、具体 `voice`、`arrangement=acappella|mixed`，来源取已确认的 `sourceId` / `songId` 或允许目录内 `file`，另有 `startSec/durationSec/lyrics/keepMelody/pitch`。返回任务ID后不重复提交。
3. `breeze_cover_status`：查询ID，可取消，不发送。
4. `breeze_cover_send`：仅主人明确要求发送后，传任务ID及明确版本；只发主人私聊。不要用真实发送来验证安装成功。

可给用户这样说：

> 使用已经安装的“Breeze翻唱”插件，用我指定的Breeze或RVC音色处理《歌名＋歌手，或已导入文件》。先做10秒清唱试听，同时保留带伴奏版。Breeze可试保留旋律2并填写片段歌词；版本不明确先让我确认。提交后查询进度，不重复创建。效果不好如实说明，不把读歌词当唱歌。未经我明确要求，不要发送QQ或重连网关。

## 验收、回退和已知边界

先隔离验证两个设置独立、非法输入拒绝、面板真实提供两种版本、本机制作不自动发送；再用用户有权使用的10秒歌曲实测分离/换声/两个文件可解码。清唱与混音核对独立文件和各自输入，记录耗时及实际后端，用户试听决定唱腔/音色效果。无需QQ的部署可以在本机完成，QQ外发另标未测。

开发机2026-11-10真实样本：RVC完成10秒CPU换声并导出两版；Breeze也完成两版。Breeze默认0、无歌词时识别几乎失败；2加片段歌词后可辨歌词改善，仍**没有主观旋律/音色保真确认**。31项歌曲库隔离回归通过，不等于另一台电脑已验收、QQ已播放或整曲已支持。共享包不含这些测试歌曲或成品。

停用 `breeze-cover` 只撤本插件与工具；回复设置继续独立。回退恢复模块备份并只重载目标模块，不覆盖整份旧配置，不删除导入/成品。原生RVC默认偏好由歌曲库适配读取，停用本插件并不会自动清除该偏好；需要回到带伴奏时单独改 `rvcArrangement=mixed` 或撤回这项适配，保留其余用户配置。
