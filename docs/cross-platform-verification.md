# 跨平台版本验证记录

## 2026-10-17：0.3.0 分屏四平台发布准备

0.3.0 交付左右/上下嵌套分屏、独立本地 shell、目录继承、面板焦点切换、分隔线比例调节和关闭后布局合并。保留 0.2.2 的外观与代理设置；布局不跨启动保存。此次范围是 Windows/Linux 的 x64、ARM64，不包含历史规划中的 SSH 管理、工作区恢复、在线更新或 macOS 适配。

- 本地 Debian 13 x64：服务测试 18 项通过，1 项 Windows 专用跳过；源码界面测试 32 项全部通过，构建、版本/lockfile 一致性、工作流 YAML 和 `git diff --check` 通过。此前分屏开发轮次也已对 Linux 解包应用通过同一套 32 项测试。
- 分屏尺寸回归已扩展为 Windows `[Console]::WindowHeight` / `WindowWidth` 与 Linux `stty size`，通过真实 PTY/ConPTY 检查缩窄面板后的列数变化。测试目录在应用关闭后清理，并为 Windows 文件句柄释放提供有限重试。
- 首轮 Windows x64 原生检查发现目录断言将同一临时目录的 `RUNNER~1` 8.3 别名和 `runneradmin` 长名称误判为不同目录；其余 30 项通过、1 项既有平台专项跳过。目录继承断言改为从返回目录读取唯一标记文件，验证实际目录归属，不依赖路径拼写。
- 发布门槛：现有四个原生 runner 分别运行服务测试、32 项源码界面测试、匹配架构的安装包构建和32项打包后界面回归。此处记录准备状态，实际原生结果以 [GitHub Actions](https://github.com/songyekun-614/terminal/actions/workflows/desktop.yml) 对应 0.3.0 提交为准。
- 正式发布任务仅在全部原生检查通过后运行，核对 10 个安装包，生成并验证 SHA256SUMS，再上传 [v0.3.0 Release](https://github.com/songyekun-614/terminal/releases/tag/v0.3.0)。版本号或 README 更新本身不表示已经发布。
- Windows 安装包未签名；Windows 10、Fedora、Arch、openSUSE 仍需实机验证。macOS 无安装包或原生验证。以下记录保留当时的验证范围，不代表当前版本状态。

## 2026-10-17：分屏开发分支本地验证（未发布）

基于已发布 0.2.2 的 `feature/split-panes` 开发分支，实现标签页内左右/上下嵌套分屏、独立 PTY、活动面板目录继承、面板焦点切换、拖动和键盘调整分隔线，以及关闭后布局合并。关闭整个标签页统一检查其中所有忙碌面板。分屏布局暂不跨启动保存。

- Debian 13 x64：`npm test` 18 项通过、1 项 Windows 专用测试跳过；`npm run build`、`git diff --check` 通过。
- 源码应用与 `desktop/dist/linux-unpacked/terminal`：分别完成全部 32 项端到端测试，其中 10 项新增分屏测试。覆盖输入输出和延迟粘贴隔离、目录继承、嵌套布局和比例调节、真实 PTY 行列尺寸、标签切换/重命名、忙碌会话确认、PTY 释放、创建与关闭重叠、跨标签并发关闭及关闭期间切换标签。
- 新增首项行为测试先在原实现上失败（缺少分屏入口），再通过实现。标题焦点、延迟创建/关闭、跨标签并发关闭的回归测试均先复现失败，再验证修复。延迟测试保留真实 PTY 操作，只延迟服务返回。
- 修复后台标签隐藏后失去布局尺寸造成的 xterm 渲染回归；保持隐藏终端的布局尺寸。分隔线具备名称、方向、比例、有效受控布局引用和键盘操作，遵循系统减少动画设置。
- 独立代码审查发现的生命周期、焦点与可访问性问题已修复并复核，无剩余阻碍。[分屏预览](images/desktop-splits.png) 为实际应用截图。
- 本地打包复用已安装的同版本 Electron：`npm run pack -- --config.electronDist=/home/song/Projects/terminal/desktop/node_modules/electron/dist`。界面/PTY 验证在执行沙箱外进行。
- 本轮仅验证 Linux x64 的源码与解包应用；未运行本次分屏的 Windows/ARM64 原生 CI，未生成新的安装器，也未发布。已发布的 0.2.2 安装包不含分屏。以下为此前版本记录。

## 2026-10-17：0.2.2 发布准备与当前四平台 CI 证据

[PR #3](https://github.com/songyekun-614/terminal/pull/3) 的 [GitHub Actions 运行 39013606856](https://github.com/songyekun-614/terminal/actions/runs/39013606856) 已完成；合并后 main 的 [运行 39014235452](https://github.com/songyekun-614/terminal/actions/runs/39014235452) 也在以下四个平台全部通过。该 PR 的 Esc 关闭功能及 shell 就绪等待测试修复已合并为 `f5d695b`；本次将包版本和安装示例更新为 0.2.2，应用与端到端测试代码保持该已审查版本。

| 原生 CI 环境 | 架构 | 结果 |
| --- | --- | --- |
| Ubuntu 22.04 | x64 | 服务测试、真实 PTY/界面测试、安装包构建、解包应用回归、产物上传全部通过 |
| Ubuntu 24.04 | ARM64 | 服务测试、真实 PTY/界面测试、安装包构建、解包应用回归、产物上传全部通过 |
| Windows Server 2022 | x64 | 服务测试、真实 ConPTY/界面测试、安装包构建、解包应用回归、产物上传全部通过 |
| Windows 11 | ARM64 | 服务测试、真实 ConPTY/界面测试、安装包构建、解包应用回归、产物上传全部通过 |

- 本轮行为：Esc 优先取消弹窗、菜单和搜索，再关闭活动标签页；最后一个标签页关闭窗口。忙碌会话保留确认，重复按键不会连续关闭。当前 Esc 也会拦截 Vim 等终端程序的同名按键。
- 测试准备修复：每项界面测试输入前等待真实 shell 的 idle 标记（最长 15 秒），避免标签页已显示但 shell 未初始化完成的竞态。
- 上述是 PR 及合并后 main 源码与解包应用的原生 CI 证据，不代表安装、升级、卸载或实体桌面验证。两次运行的 release job 均为跳过，未发布 0.2.2；实际发布和校验值以之后的 Release 工作流为准。
- Windows 安装包未签名；Windows 10、Fedora、Arch、openSUSE 仍需实机验证。macOS 目前没有安装包或原生验证。

以下保留各次验证当时的结果和限制，旧记录中的“未验证”“未发布”仅描述其对应日期与轮次。

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
