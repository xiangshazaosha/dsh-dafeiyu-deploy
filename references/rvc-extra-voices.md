# 只增加 RVC 音色模型

用户要御姐、甜美、二次元、角色音色或多个翻唱声音时读取。这里只加 `.pth` 与可选 `.index`，复用已有引擎；不是重新安装几GB的 Applio/Python，不改 Breeze，不默认更改肥鱼原音色。

## 来源与选择

核对发布者、训练声音来源、模型/索引下载、版本与摘要、README/NOTICE及适用许可。免费可下、CC BY-NC、角色知名度都不能替代底层声音/角色权利人授权；不宣称同人模型是官方角色音色或无条件可商用，也不凭主观印象保证“最热门/最好听”。用户选择个人非商业时仍按发布者当次条件及相关权利使用，公开发布/商用另核对。

`assets/rvc-five-candidates.json` 仅是 2026-11-08 已核对的五款**候选元数据**，不含权重或索引：御姐向雷电将军、甜美向爱莉希雅、二次元活泼胡桃、神里绫华、温柔流萤。来自 [Hanazar-Games/RVC-voice-models](https://github.com/Hanazar-Games/RVC-voice-models)，发布者 Charlie Zhong，标注 CC BY-NC 4.0、个人/学习/非商业、禁止冒充，为同人实验模型；不是 HoYoverse/原配音官方授权。风格标签不是已听感验收。

根据用户选择增减候选，不自动所有用户都装这五款。执行时重读仓库和对应 release，从 GitHub API `releases/tags/<tag>` 核对同名独立资产的 `digest`、`size` 和URL；内容或许可变更先停，不机械信任旧清单。固定资产摘要与来源到本机安装记录。

这五个独立权重约278MB（十进制），每款约55–58MB，发布页同时有数GB训练包，不为取得同一个推理权重去下整套训练包。当前独立资产不含附加索引，必须报告“无 index 版”，不要把 index 缺失说成不能使用，也不要把没有索引假报“带 index”。

## 自动执行与安全检查

1. 检查现有 `song.root`、模型列表、实际 Python/引擎。配置可能有联接，以物理路径、有效配置为准；不扫描或改系统 Python。下载前说明体积、用途与默认不变。
2. 为本次已审查候选生成/剪裁 manifest（`models` 数组：id、bytes、sha256、url、source、usageNotice）。`scripts/install-rvc-models.py --root <现有RVC根> --manifest <已审查清单>` 默认仅检查；用户已选且适用用途核对后 `--apply`。它复用 `<root>/env/Scripts/python.exe` 与 Applio，对不同布局先适配，不用它安装环境。
3. 下载在模型目录外暂存，精确大小与 SHA256；用已有 CPU Torch 运行 `scripts/inspect-rvc.py MODEL SHA256`。先静态 globals 检查、`torch.load(weights_only=True,map_location='cpu')`，再看 RVC `weight/config`、张量与有限值。失败不把 `weights_only` 改成 False，不随意 allowlist 未知对象，不执行 pickle。
4. 检查通过才复制到 `<root>/models/<唯一ID>.pth`，同名不同内容拒绝覆盖。模型名保持可读；保留原肥鱼、默认 `song.voice`、`voice.songVoice` 和 Breeze 设置。脚本写每个成功模型的来源记录，后续模型失败不伪报全装完。
5. 可选索引也必须来源/哈希匹配，与权重同名；不能从不明压缩包拿不兼容索引。当前 helper 只处理已校验的独立 `.pth`，不声称已导入 `.index` 或训练ZIP。

## 验收和切换

从已安装 Aurabot 的 `listVoices` / `/song/status` 读回实际ID、hasIndex和默认。只装权重不需要启动QQ；宿主在运行则直接读动态列表，不为模型触发社交/网关或重启。

用用户有权处理的已分离演唱或其提供录音先做10–20秒本机换声。可运行：

`node scripts/test-rvc-voices.mjs --plugin-dir <插件> --root <RVC根> --input <独立人声> --output <新的试听目录> --voices <精确ID,精确ID> --seconds 10`

先加 `--check-only` 验证列表和输入，不改默认、不发QQ。实际测试串行、保留原音、检查可解码和非静音、记录耗时；从模型列表精确匹配，不能让引擎悄悄 fallback 肥鱼还假称角色测试成功。男声转女声是否升调由源音和听感决定，先报告实际 pitch；不是只要女性模型就无条件+12。

开发机五款均通过10秒 CPU换声，约17–24秒/款，真实声音还需用户听感确认；不代表这批是CPP模型或已用RX 7700 XT加速，也不代表分离/整曲/QQ端已验收。

切换优先使用[独立音色页](voice-controls.md)，或经当前版本核对的“表达 → 翻唱 → 声音 → 音色”。`/音色` 是 Breeze 讲话命令，不切RVC；别编造尚未注册的 `/翻唱音色` 指令。新选模型不改变之前已制作的库内歌曲声音。
