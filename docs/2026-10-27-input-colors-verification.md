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
