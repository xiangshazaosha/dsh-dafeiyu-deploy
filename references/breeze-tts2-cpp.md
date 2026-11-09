# Breeze TTS 2：本机 C++ 语音、原创音色与实验换声

用户明确选择 Breeze TTS 2、本地离线说话或适配 AMD 后读取；不因用户只加 RVC 模型就顺便部署。语音引擎、模型、配套 tokenizer 和音色是不同文件，先复用现有成功环境，不重装 RVC Python、不升级显卡驱动。

## 来源、版本与下载

- 原模型：[BreezeBlue/Breeze-TTS-2](https://huggingface.co/BreezeBlue/Breeze-TTS-2)。
- 第三方 C++ 项目：[HoppouAI/Breeze-TTS-2.cpp](https://github.com/HoppouAI/Breeze-TTS-2.cpp)，不是原模型官方 C++ 发行版。
- [发行包](https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases)、[GGUF](https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp)。

执行时从 GitHub `releases/latest` 核对最新稳定平台资产、SHA256 和解压结构；从 Hugging Face 文件元数据取得选定 GGUF、完整 audio_tokenizer 及模型许可，固定仓库 revision 与每个文件摘要到**用户本机**安装清单。不要把下面的历史版本当默认最新，也不把软件代码许可当模型/声音商用许可。

先告知所选量化和配套文件的总下载/解压/临时空间，确认用途符合当次模型许可；个人非商业的历史确认不自动授权其他使用者。历史 Q8_0 GGUF 约 3.57GB，配套 tokenizer 约 682MB，总模型约 4.25GB；不是只下 GGUF 就能运行。

Agent 负责下载与部署。`scripts/fetch-verified.py URL DEST SHA256 --size BYTES` 可在已有可信 Python 中运行；默认每个 4MiB 分块、8 个连接、有限重试、精确 Content-Range 与最终 SHA256，已有同名不同内容拒绝覆盖。曾出现 16MiB 请求长时间无正文而 4MiB 成功；不是每种站点都支持 Range，连续失败则诊断源/API 资产地址，不无限换镜像、清空用户数据或绕过权限。

先检查 ZIP 路径越界、绝对路径与 symlink 后解到新的 runtime 子目录；原模型、tokenizer 及其相对目录按所选引擎要求放置。下载器不代替安全解压器，也不接受来源不明散装 DLL。

## Vulkan 与 AMD：先实测默认，再按证据兼容

1. 对已校验的所选 `breeze-server.exe` 读 `--help` 及其本机 API 文档，确认下述 CLI/协议仍适用；失败停止适配，不盲降级旧版。2026-11-08 验证过第三方 v0.1.6 Windows x64 Vulkan，包含 `/health`、`/v1/audio/speech`、`/v1/voices` 和实验 `/v1/audio/convert`。
2. 服务只监听 loopback。示例资产用 `--host 127.0.0.1 --port <已核对空闲端口> --ws-port -1 --voices-dir <voices>`；端口在用户自己的 runtime 配置中，不能覆盖占用中的服务或把接口暴露公网。
3. 先试默认 GPU 预热/短语音，并检查实际后端。RX 7700 XT + 当时 2024 驱动曾在协作矩阵预热中退出 `0xc0000409`；仅对子进程设 `GGML_VK_DISABLE_COOPMAT=1` 后成功，仍走 Vulkan。**这不是所有 AMD 都必须设的开关，更不是 CPU 回退或 RVC 已获 AMD 加速。** 新驱动/新引擎重新测；不改全局环境变量、不擅自更新驱动。
4. 失败不循环崩溃；保留诊断、文字回复，不偷偷改成 Edge 或 Windows 声音。历史兼容模式约 16 秒预热，7.8 秒声音约 28 秒生成，仅是这台机器的记录，不保证实时。

## 可复用扩展与配置

`assets/breeze-voice/` 只包含本技能原创适配代码。它复用已安装内置语音模块的 ASR/诊断，替换合成与试听；不随包带引擎、权重、参考音频、`.breeze` 或用户设置。当前接口契约来自 Aurabot 1.1.24，其他版本先查 API/源码。

在选定 Breeze 根目录创建本机 `breeze-runtime.json`，字段：

| 字段 | 用途 |
|---|---|
| `exe` | 已核对的可执行文件路径，相对根目录或根目录内绝对路径；不固定发行包版本目录 |
| `model` | 根目录内已校验的 GGUF 文件路径 |
| `port` | 核对空闲的本机端口，默认候选 18370，不是宿主 DSH 动态端口 |
| `disableCoopmat` | 默认 false；只在上述故障复现且兼容验证后设 true |
| `sourceRoots` | 明确允许的歌曲库、歌曲缓存、试听目录绝对路径；实验换声会 realpath 检查，默认空列表拒绝读取 |

运行时适配器默认从 `<root>/models` 作为声码器工作目录；先对照所选引擎布局，确保完整 tokenizer 在其要求的相对位置。所有路径从实际用户目录取得，不照抄开发者的 D 盘/用户名。

准备合成音色：`node scripts/prepare-breeze-voices.mjs --root <实际Breeze根目录>`。它调用已核对的本机生成/音色保存接口，设计晴岚（温柔女）、灵汐（活泼女）、晚宁（偏低女）、星舟（清朗男），同文案逐个试听并保存。已有样例/音色保留，不将某真人/角色声音冒称原创。四个只是这套预设，不是引擎只有四种声音；新增音色按所选版本能力和授权单独准备。

部署步骤：

1. 准备并验证 runtime JSON、引擎/模型、tokenizer、四款 `.breeze` 和短合成。必要健康检查会启动自己的服务，不影响已经运行的 RVC；需要释放服务时只关闭本次拥有的子进程。
2. 通过已核实的 Aurabot **部分保存 API** 设置 `ext.voice.breezeRoot` 为实际根目录，`breezeEnabled=true`，初选音色尊重用户偏好；`modules.voice.enabled=true,useBuiltin=false`。只改这些字段，不覆盖完整旧 state/私有配置，不开启 QQ 或社交。
3. `node scripts/install-voice-module.mjs --plugin-dir <插件> --data-dir <Aurabot数据> --module breeze-voice` 默认检查；确认输出后 `--apply`。存在不同的自定义语音模块时停止，先审查与备份，明确替换才加 `--replace --backup-dir <新备份目录>`。安装器不改配置、不安装软件，不能因为版本号相同就跳过 API 检查。
4. 原子复制后从本机 `/modules/reload` 仅重载 `voice`，检查 running=user、error 为空；新 schema 不等于面板一定显示，接着按[音色与回复控制](voice-controls.md)安装可见入口。
5. `/voice/test` 真正产生所选引擎的非空、可解码 WAV；再按用户范围验证 QQ。`/breeze/status` 不主动启动引擎，尚未按需启动时 ready=false 不等于模型没安装。

`/音色` 列表、`/音色 晚宁` 等主人命令只改讲话，不改 RVC。关闭 Breeze 恢复原内置引擎属于用户明确选择的回退，不是失败时静默降级；语音失败仍由中枢保底文字。

## 实验换声不是常规 RVC 翻唱

仅当主人明确要求 Breeze 实验换声时使用扩展提供的 `breeze_convert_vocal`。音源必须在本机允许根内、已分离人声 WAV、1–180秒、64MB内，校验实际 WAV 字节率/数据长度；不接受任意文件路径、整首伴奏或从 QQ 文本读取根外文件。输出只留本机，不自动外发。

原生转换可能改变旋律、音高、咬字；2026-11-08 曾对已有 8 秒演唱转换成功，不等于整首保真。稳定角色翻唱继续走 RVC，两种音色格式不互通。普通文字朗读、原生实验转换、RVC 音色、演唱来源与 QQ 回传分别验收。

## 测试与边界

- `node --test scripts/test-breeze-voice.mjs scripts/test-install-voice-module.mjs`：可配置路径/越界防护、音色选择、旧 ASR 保留、WAV时长、停止后不联网、安装备份；HTTP 是本机模拟，不证明真实模型音质。
- 重复部署时先复用已成功的模块，不把更新技能变成重装运行中的语音服务。运行配置损坏时扩展保持加载、合成失败转文字，不从 setup 抛错触发宿主自动恢复在线内置引擎；修好路径后只重载语音模块。
- 适配器排队串行且合成有超时。长回复需要更久，不能用“已提交”代替真正输出；听感要用户试听。
