# 四款文字V2：固定音色与提示词分别负责什么

用户已接受这四款纯文字设计时读取；不因只部署其他声音而启用。全部是 Breeze 从描述生成的新声音，不使用视频、外部录音或人声分离；不要恢复用户已淘汰的两款声音，也不要把仅本机授权的视频克隆打包上传。

## 已保存的数据，不是部署时重抽声音

| 文件 | 内容与用途 |
|---|---|
| `assets/breeze-presets/*_text_v2.breeze` | 已保存的四款固定音色数据，默认部署直接校验导入 |
| `assets/breeze-presets/manifest.json` | 对应名称、提示词、风格指令、种子、参考文字、摘要及是否统一音量 |
| `assets/breeze-voice/*.mjs` | 讲话接入、音色列表和选定V2的每次输出响度统一 |
| 本机 WAV | 试听与参考原件，仅留本机，不在共享技能内 |

`.breeze` 是第三方引擎的 BRZV 小型二进制容器，本包为 version 2；包含 codec 编码、参考文本和描述/元数据，不是可播放录音，不是完整基础模型，也不是 RVC `.pth`。声音编码需要匹配的 Breeze 基础模型、tokenizer 和 C++ 引擎才能把新文字读出来；不是把已录好的几句话重复播放。文件小不代表缺少几十亿参数，基础权重是单独复用/获取的。

格式来源：[第三方引擎 voices 文档](https://github.com/HoppouAI/Breeze-TTS-2.cpp/blob/main/docs/voices.md#the-breeze-file)。编码并非永久通用声纹格式；跨模型/codec版本需复验，原始生成WAV仍由用户本机保留。提示词和种子用于说明、调整或在用户要求时重新设计，不能保证跨模型版本逐字节重建同一音色；默认直接导入成品，不重抽。

## 选中项

| ID | 菜单名称 |
|---|---|
| `aojiao_text_v2` | 傲娇大小姐（文字V2） |
| `sajiao_text_v2` | 撒娇女友（文字V2） |
| `wenrou_text_v2` | 温柔姐姐（文字V2） |
| `taiwan_text_v2` | 台湾腔甜妹（文字V2） |

这四款有独立ID/名称，默认与旧版并存，保留当前讲话、视频版、私人声音、RVC和回复模式。只在用户明确要求替换或切换时改对应设置。

## 最小部署

1. 复用已经健康的 Breeze 运行时，确认模型/codec与BRZV兼容及用途符合随包非商用许可。
2. 在实际 `breeze-runtime.json` 的 `ffmpeg` 字段填已核对的FFmpeg文件路径，复用已有安装；这不是网络服务或上传地址。泛化语音扩展至少v1.4.0，新增 `loudness.mjs`。本案例本机定制v1.2.6已具备同等能力，并从自身 `audio-output.json` 读取已核对路径，不按版本号强制覆盖成泛化版。升级自定义代码先预检、审查差异、备份，不能用技能更新擅自覆盖本机其他定制。
3. 仅导入四款：

   ```text
   node scripts/install-breeze-presets.mjs --root <实际Breeze根目录> --voices aojiao_text_v2,sajiao_text_v2,wenrou_text_v2,taiwan_text_v2
   ```

   默认只检查。用途已核对且本次允许导入后，增加 `--apply --non-commercial`。SHA256相同文件复用，冲突拒绝覆盖，合并时保留其他音色和旧版本来源记录。完整流程见[固定音色包](breeze-saved-presets.md)。

4. 仅在需要时重载语音模块；在 **Aurabot → 系统 → 音色切换 → 讲话音色** 核对四个“文字V2”。当前选择不变，导入不等于自动切换。
5. 每款用保存的声音读一段新文字，并验证输出可播放、文字完整、响度及用户听感。四款V2保留固定参考+原风格指令；每次实际输出执行双遍响度统一，约-16 LUFS、真峰值目标-1.5 dBTP。不是只放大试听WAV，也不是去噪/人声分离；不声称能恢复缺失细节。其他声音不自动归一化。路径缺失或处理失败时报错并由原聊天中枢文字兜底，不改在线声音，不生成削波文件。

## 验证范围

`DSH_TEST_FFMPEG=<已核对路径>` 后运行 `node --test scripts/test-breeze-loudness.mjs scripts/test-breeze-presets.mjs scripts/test-breeze-voice.mjs scripts/test-install-voice-module.mjs`。不提供该环境变量时，真实FFmpeg两例跳过，其余测试仍运行。测试包含拒绝覆盖、缺失路径、正常音量处理、静音失败和输入保持，不用文件存在代替实际音频处理。

2026-11-10 四款文字设计试听获用户同意加入，另在本机真实引擎上用保存音色完成新句子合成和音量处理；不等于对所有文本的音色一致性保证，也不等于QQ收件播放或其他机器已验收。
