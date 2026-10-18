# 2026-10-18 分屏与打包交付核实

本轮核实已合并的分屏版本，并重新生成、验证本地解包应用。

- 主分支提交：`94d218860edda415657bcfa4daf0a7bd5b821d68`，版本 `0.3.0`。
- [v0.3.0 正式 Release](https://github.com/songyekun-614/terminal/releases/tag/v0.3.0) 已于北京时间 2026-10-18 00:08:11 发布，非草稿、非预发布。
- 通过 GitHub 连接器读取实际 Release 和任务状态：[运行 39047315655](https://github.com/songyekun-614/terminal/actions/runs/39047315655) 的 Ubuntu x64/ARM64、Windows x64/ARM64 四个原生任务以及 release 任务均为 success。
- Release 实际包含 10 个安装包及 `SHA256SUMS`：Linux 每种架构的 AppImage/deb/rpm，Windows 每种架构的 setup.exe/zip。资产均为 uploaded，具有 SHA256 digest。本轮未重新下载全部安装包校验其字节内容。

## 本轮本地验证

在 `/home/song/Projects/terminal/desktop` 执行：

```bash
npm test
npm run build
npm run test:e2e
npm run pack -- --config.electronDist=/home/song/Projects/terminal/desktop/node_modules/electron/dist
TERMINAL_TEST_EXECUTABLE=/home/song/Projects/terminal/desktop/dist/linux-unpacked/terminal npm run test:e2e
git diff --check
```

- 服务测试：18 项通过，1 项 Windows 专用测试跳过，无失败。
- 构建与打包成功。沙箱内打包的依赖收集失败，同一命令在主机环境成功；Electron 图形与真实 PTY 测试也在主机环境运行。
- 源码应用：32 项端到端测试通过（28.7 秒）。
- 新打包应用：32 项端到端测试通过（29.2 秒）。
- 测试包含独立分屏输入输出、目录继承、嵌套分屏、鼠标/键盘比例调整、真实 PTY 尺寸、焦点/粘贴隔离、忙碌确认、并发创建关闭、资源释放及既有设置/剪贴板/Esc 行为。
- 已读取新 `app.asar` 的 package.json，确认版本为 0.3.0，renderer bundle 包含分屏代码；主分支工作区无源码改动，diff 检查通过。

本地可执行文件：`/home/song/Projects/terminal/desktop/dist/linux-unpacked/terminal`。

## 本地安装更新

- 已安装到 `/home/song/Apps/terminal/0.3.0`，`/home/song/Apps/terminal/current` 指向该版本；226 个安装文件与已验证的打包目录逐一核对 SHA256 和权限一致。
- `~/.local/bin/terminal` 指向安装后的程序。应用菜单的 `io.github.macstyle.Terminal.desktop` 已从 GNOME Terminal 改为启动该程序；修改前的入口已备份，desktop-file-validate 和桌面数据库更新通过。
- 继续使用 `~/.config/mac-style-terminal`，安装过程未改写用户设置。
- 使用实际安装命令运行 `TERMINAL_TEST_EXECUTABLE=/home/song/.local/bin/terminal npm run test:e2e`，32 项测试全部通过（31.6 秒）。界面测试使用独立临时配置目录。

## 交付范围

当前交付为 Windows/Linux 分屏与安装包；历史综合计划的 SSH 管理、工作区恢复、快捷键配置、在线更新和 macOS 不在此次 0.3.0 的已交付范围。Windows 安装包未签名，Windows 10、Fedora、Arch、openSUSE 实体桌面验证及安装/升级/卸载生命周期验证不由上述测试替代。
