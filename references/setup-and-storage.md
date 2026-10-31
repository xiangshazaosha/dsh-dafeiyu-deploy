# 安装与存储

## 宿主预检

DSH桌面说明：<https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/desktop>。
确认实际运行版本、内置CLI路径、`DSH_HOME`、profile、已有插件/会话与用户要求的盘。Windows桌面版CLI一般在应用的 `resources/runtime/cli/bin/dsh.cmd`，不能假定在C盘。

桌面profile先打开一次初始化，再从托盘完全退出，安装插件后完整重启。关窗可能仅隐藏。不要强杀运行中的任务，不自动卸载/升级宿主。

## 插件

- Aurabot：<https://github.com/accomplish07zrh-eng/dsh-aurabot-qq>
- 动画桌宠：<https://github.com/PC2005-cloud/dsh-pet>

先只读检查用户所选插件是否已注册且正常加载。健康的跳过，未知/加载失败先诊断，不能据此全重装。核对当前README和 CLI `plugin --help`，仅对确实缺失且所选的插件执行对应的一行（不是让两行默认全跑）：

```powershell
& '<DSH_CLI>' plugin --profile desktop add github:accomplish07zrh-eng/dsh-aurabot-qq
& '<DSH_CLI>' plugin --profile desktop add dsh-pet
```

网页profile通常为`web`，桌面为`desktop`。随包 `install-plugins.ps1 -DshCli '<实际路径>' -Profile desktop -Plugins aurabot` 只装 Aurabot；`-Plugins pet` 只装桌宠；仅两者都缺且都选中才用 `-Plugins aurabot,pet`。脚本不会自动判断已安装状态，必须由 Agent 预检后调用，不把它当完整诊断器。失败先查网络/代理/日志，不清用户配置。成功退出码后仍需重启检查所选插件面板。
两插件彼此独立：桌宠出现不代表QQ/音频已接好。

## 路径必须逐项检查

| 对象 | 配置/常见默认 | 处理 |
|---|---|---|
| 插件程序 | `<DSH_HOME>/profiles/<profile>/node_modules/dsh-aurabot-qq` | 宿主管理，不能直接剪切 |
| 配置/人格/记忆/日志 | `<DSH_HOME>/plugins-data/aurabot` | 当前版本支持`AURABOT_DATA_DIR` |
| QQ工作区 | `workspaceDir`或`AURABOT_WORKSPACE` | 通过`/save`明确填写并查实时状态 |
| TTS环境 | `AURABOT_PYENV` | `<ROOT>/Aurabot/voice` |
| 翻唱环境 | `song.root` | `<ROOT>/Aurabot/sing-cpu`或GPU独立环境 |
| SnowLuma | `snowluma.dir` | 用户安装目录，直接有`index.mjs` |
| B站抽帧 | `bili.ffmpegPath` | 与翻唱FFmpeg不是同一设置 |
| 抖音浏览器 | `douyin.browserPath`及源码资料路径 | 独立资料目录，不碰日常浏览器 |
| DSH会话/缓存 | DSH_HOME、Electron数据、包管理器store | 不等同于Aurabot数据 |

启动前环境变量才对新进程生效；优先使用仅应用启动器传变量，避免全局影响其他软件。不能说“程序在D盘，所以数据也都在D盘”。`index.mjs`是SnowLuma入口，不是Aurabot目录。

## 已有目录迁移

完全退出后备份、复制、核对数量/大小和必要SHA，再切配置；验证前不删原副本。
- 数据用受支持环境变量/配置。迁Aurabot不应顺便迁全部DSH用户数据。
- Windows只迁插件程序时可经用户同意保留原查找位置的目录联接。说明真实文件在新盘、入口仍在旧盘，升级可能重建；升级后重新检查。不同平台不要套用联接命令。
- pnpm包文件可能是硬链接。代码补丁先备份，用新临时文件原子替换，不能原地写坏共享store；不迁整个共享包存储只为一个插件。
- Python虚拟环境换目录应重建，不剪切后宣布可用。
- 实际配置、面板默认提示、物理落点分别核对。`song.root`有值时旧`defaultRoot`提示不改变实际执行，但需解释；用户要求改源码默认值时留小补丁并告知升级覆盖风险。
- 递归移动/删除前检查解析后的绝对路径在本次目标树内，避免跟随联接。保留凭据的备份只留用户本机，不进共享skill。
