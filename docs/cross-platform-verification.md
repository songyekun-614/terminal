# 跨平台版本验证记录

## 2026-10-17：Esc 关闭功能本地验证

基于 0.2.1 源码，验证本地尚未发布的 Esc 关闭功能：弹窗、菜单、搜索栏优先取消，其次关闭当前标签页，最后一个标签页退出窗口；忙碌会话保留关闭确认，长按和确认等待期间的重复按键不会连关标签页。

- Debian 13 x64：`npm test` 18 项通过、1 项 Windows 专项跳过；`npm run build` 通过。
- Electron 源码版：22 项端到端测试全部通过，其中 9 项覆盖 Esc 行为。重命名测试等待保存后的标题更新，再重开弹窗，避免异步关闭事件尚未完成就继续下一步。
- 使用已安装的 Electron 完成本地打包：`npm run pack -- --config.electronDist=node_modules/electron/dist`；`desktop/dist/linux-unpacked/terminal` 的同一套 22 项测试全部通过。
- 界面测试在当前执行沙箱外运行；沙箱内 Electron 启动被系统调用限制拦截。
- 本轮未生成 AppImage/deb/rpm 或 Windows 安装包，未验证 Windows/ARM64，也未发布。以下为此前版本的历史记录。

日期：2026-10-14，版本：0.2.0。

## 复制粘贴修复验证

2026-10-14 后续修复：支持 Ctrl+V，以及选区存在时 Ctrl+C 复制；保留无选区 Ctrl+C 中断命令。菜单复制、粘贴、全选后恢复终端焦点，空选区复制不清空剪贴板，搜索和设置输入框继续使用原生剪贴板操作。

- Debian 13 x64 开发版本与重新打包的 `desktop/dist/linux-unpacked/terminal`：各 10 项端到端测试通过，其中 5 项覆盖剪贴板与输入框行为。
- Node 服务测试：5 项通过，1 项 Windows PowerShell 专项跳过。
- `npm run build`、`npm run pack` 和 `git diff --check` 通过。
- 本轮仅更新源码与 Linux 解包应用；下文列出的 AppImage/deb/rpm、Windows 安装器/zip、Windows 解包应用和 SHA256SUMS 保留上一轮产物，未包含本次修复。Windows 与 ARM64 尚未运行本次修复的原生测试。

直接启动修复版本：`./desktop/dist/linux-unpacked/terminal`；源码方式为 `cd desktop` 后执行 `npm start`。

## 实际结果

| 平台 | 本地产物 | 本次验证 |
| --- | --- | --- |
| Debian 13 x64 | AppImage、deb、rpm | 原生 PTY 与打包后的应用运行通过 |
| Windows x64 | NSIS 安装器、zip | 包构建、zip CRC、PE 架构、ConPTY 文件、安装器档案完整性通过；未运行原生 Windows 应用 |
| Windows ARM64 | NSIS 安装器、zip | 包构建、zip CRC、PE 架构、ConPTY 文件、安装器档案完整性通过；未运行原生 Windows 应用 |
| Linux ARM64 | 已配置原生构建工作流 | 本机未生成此架构产物，也未运行；需要对应 CI runner 或 ARM64 桌面机器 |

Windows 10/11、Ubuntu、Fedora、Arch、openSUSE 是适配目标。本次 Debian 测试不能代替这些系统的实际验证。GitHub 工作流尚未在远端执行。

## 测试

- 原有 GTK/Python：65 项通过，存在原有 GTK 弃用警告。
- Node 服务：5 项通过，1 项 Windows PowerShell 专项在 Linux 跳过。
- Electron 开发版本：5 项通过。
- Electron 打包版本：5 项通过。
- AppImage 解压后 AppRun：真实 PTY、Unicode、标签页、外观、搜索、运行命令关闭确认测试通过。
- Builder 配置 schema、四个原生 runner 的 workflow YAML 均验证通过。
- Windows 两个 zip 的全部文件 CRC 正常；主程序和各架构的 PTY `.node` 文件分别为 PE x64 / ARM64；ConPTY DLL 与 OpenConsole.exe 存在。
- 两个 NSIS 安装器均通过 7-Zip 档案完整性验证，包含实际应用载荷。
- 三个解包应用的 main、sessions、提示符脚本和 renderer bundle 均与当前源码一致。

验证发现并修正的问题包括：取消导入留下壁纸副本、PowerShell 覆盖自定义 prompt、重载后遗留 PTY、失效 shell 选择阻止启动、打包后的系统 shell 无法读取 ASAR 内脚本，以及 Ctrl+0 未恢复已保存字号。

## 产物

位于 `desktop/dist/`，七个完整安装包的 SHA256 位于同目录 `SHA256SUMS`：

- terminal-0.2.0-linux-x86_64.AppImage
- terminal-0.2.0-linux-amd64.deb
- terminal-0.2.0-linux-x86_64.rpm
- terminal-0.2.0-windows-x64-setup.exe
- terminal-0.2.0-windows-x64.zip
- terminal-0.2.0-windows-arm64-setup.exe
- terminal-0.2.0-windows-arm64.zip

安装包在本地生成，没有上传 GitHub，也没有安装到当前系统。Windows 未签名，卸载配置为保留用户设置与壁纸。

Linux 包在本机原生构建。缺少 rpm 权限安装时，从 Debian 软件源下载并解包 RPM 构建工具到临时目录使用，没有修改系统依赖。

Windows 包使用 node-pty 发布的 Windows Node-API 预构建模块，主程序 Electron 下载文件与 npm 包提供的官方 SHA256 一致。NSIS 在含 Wine 11 的隔离 Docker 环境构建，Docker 镜像固定为 `electronuserland/builder@sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64`。构建时显式关闭仅用于本地跨平台打包的依赖重编译；原生 CI 保留正常重编译与真实 ConPTY 测试。

完整功能与安装步骤见 [跨平台使用说明](cross-platform.md)。
