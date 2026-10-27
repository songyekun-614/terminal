# 输入配色与 CLI 兼容性验证

验证日期：2026-10-27。功能源码为 `6aaf227`，分支为 `local/input-colors-cli-sync`，基于 0.4.0 当前开发代码，包含 Esc 传递修正、输入框与复制选区配色、ANSI 输入低对比保护及对应回归测试。界面测试自动生成的 `desktop-linux.png` 最终与已有提交一致，无额外截图差异。

## 本地验证

在 Linux x64、Node.js v22.23.2、npm 10.9.8 环境执行：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Electron 服务与配色单元测试 | `cd desktop && npm test` | 36 通过、1 个 Windows 专项跳过、0 失败 |
| 渲染器构建 | `cd desktop && npm run build` | 退出码 0 |
| 完整 Electron / 真实 PTY 界面回归 | `cd desktop && npm run test:e2e -- --trace retain-on-failure` | 52 通过、1 个 IBus 专项跳过、0 失败 |
| 原有 GTK 版本测试 | `python3 -m unittest discover -s tests -v` | 34 通过、34 个桌面专项跳过、0 失败 |

界面回归覆盖 ANSI 深浅背景输入、中文内容、透明壁纸、三个外观配置与背景预设、选区可读性、分屏拖动与键盘调整、真实 PTY、剪贴板、Esc 传递、自定义快捷键及异常恢复。

## 验证过程中观察到的问题

- 受限执行环境无法连接本地代理，Electron 启动报 `Operation not permitted`。允许网络和桌面访问后，远程分支读取及 Electron 启动成功，无需修改产品代码。
- 首轮桌面回归为 51 通过、1 失败、1 跳过；失败项为分屏拖动后宽度未变化。相同源码下，该项单独连续执行 3 次均通过，随后完整套件 52 通过、1 跳过。记录为一次未稳定复现的拖动测试失败，不据此声称已消除偶发问题。

## 验证边界

本地结果仅证明以上执行环境与测试范围。IBus 输入法专项、GTK 桌面专项和其他操作系统未由本地测试验证。Windows / Linux x64、ARM64 的原生构建、界面回归及打包回归以本次 PR 对应的 GitHub Actions 结果为准。此次源码同步不更新既有 Release 标签或安装包。

## CI 等待条件修正

[PR #8](https://github.com/songyekun-614/terminal/pull/8) 的[首轮工作流](https://github.com/songyekun-614/terminal/actions/runs/40506354245)中，两个 Linux 架构均在 ANSI 输入测试的提示计数处失败：要求出现 2 次提示文本，实际只有 1 次。其余 51 项通过、IBus 专项跳过。

用清屏控制序列移除命令回显后，本地复现了相同的计数失败。测试改为检查真实提示行；追踪还发现保存设置后过早打字会丢失命令开头，因此增加对设置窗口关闭和终端焦点恢复的等待。对比度和中文输入往返断言保留，产品代码未修改。

修正后执行 `cd desktop && npm run test:e2e -- --grep 'text typed into ANSI-styled' --repeat-each=3 --trace retain-on-failure`，连续 3 次通过。最终四平台结果以更新后提交的工作流为准。

## Windows 测试脚本修正

[第二轮工作流](https://github.com/songyekun-614/terminal/actions/runs/40507169770)中，两个 Linux 架构的服务测试、源码界面回归、安装包构建及打包后回归均成功，两轮界面回归各为 52 通过、1 跳过。

两个 Windows 架构的 ANSI 输入测试均能显示输入的中文，但 `.NET Console` 输出回传内容为 `INPUT:cli_input_0_??`；壁纸测试未等到预期命令输出。Windows x64 还出现 15 标签页及最后恢复用例的退出清理超时，ARM64 未出现这两项超时。

测试脚本显式设置 `Console.InputEncoding` 和 `Console.OutputEncoding` 为 UTF-8，并为壁纸用例增加设置窗口关闭、终端焦点和 shell 空闲等待。Console 编码说明见 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/console/console-code-pages)。中文内容与对比度断言保留，退出清理超时继续如实记录。

本地执行 `cd desktop && npm run test:e2e -- --grep 'text typed into ANSI-styled|light wallpaper panels' --repeat-each=3 --trace retain-on-failure`，6 项通过；Windows 脚本分支需由后续原生 CI 验证。
