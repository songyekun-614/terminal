# terminal

一款支持 Windows 和 Linux 的独立终端。默认使用 `desktop/` 中的 Electron + xterm.js + node-pty 版本，运行真实的本地 shell，提供标签页、左右/上下分屏、中文外观设置和壁纸。Windows 使用 PowerShell / cmd，Linux 使用用户 shell。

当前正式版本为 **[0.4.0](https://github.com/songyekun-614/terminal/releases/tag/v0.4.0)**，新增自定义快捷键与异常退出恢复。已通过 Windows / Linux 的 x64、ARM64 四个平台验证，提供 10 个安装包及 `SHA256SUMS`。

沿用 B 版分屏设计：12px 圆角、2px 接缝和 12px 拖动区域。关闭任意标签页及退出窗口都会先确认，空闲会话也会提醒。

## 分屏与常用操作

打开 terminal，点击标签栏下方的“左右分屏”或“上下分屏”，也可使用以下快捷键：

| 操作 | 快捷键 |
| --- | --- |
| 左右分屏 | Ctrl+Shift+H |
| 上下分屏 | Ctrl+Shift+J |
| 切换到下一个面板 | Ctrl+Shift+O |
| 关闭当前面板 | Ctrl+Shift+X |
| 新建标签页 | Ctrl+Shift+T |
| 关闭整个标签页 | Ctrl+Shift+W |
| 搜索当前面板 | Ctrl+Shift+F |
| 外观设置 | Ctrl+, |

每个面板运行独立 shell，新面板继承当前面板的目录。点击面板切换输入焦点，拖动分隔线调整大小；可继续嵌套分屏，关闭面板后剩余面板自动填补空间。复制、粘贴和搜索作用于当前面板，配色、字体和壁纸设置应用于所有面板。

![terminal 左右与上下嵌套分屏](docs/images/desktop-splits.png)

`Ctrl+V` 可直接粘贴；`Ctrl+C` 在有文字选区时复制，没有选区时中断命令。也支持 `Ctrl+Shift+C` / `Ctrl+Shift+V`。

输入框提供 Pro 蓝灰、Basic 暖白、Homebrew 绿灰配色，区分悬停、焦点与选中文字。终端复制选区按实际背景自动选择浅蓝或深蓝，并使用配套文字颜色；预设、自定义背景和壁纸下都保持清晰，失去焦点后仍保留可辨认的选区。

交互式 CLI 自行设置 ANSI 输入背景和文字颜色时，终端会按字符的实际前景/背景调整低对比文字，避免深色输入区内的黑灰字看不清。此保护保留输入内容、ANSI 背景和中文输入；透明壁纸仍使用配色背景参与对比度计算。

当前源码中，`Esc` 只取消弹窗、菜单或搜索；终端获得焦点时直接传给 CLI，不再关闭面板、标签页或窗口。关闭面板使用 `Ctrl+Shift+X`，关闭标签页使用 `Ctrl+Shift+W`。关闭标签页或退出窗口始终要求确认，单独关闭分屏面板时在会话忙碌时确认。正常退出后不恢复布局；异常退出后，下次启动可选择恢复标签页、分屏和目录。更多分隔线键盘操作及使用限制见[分屏说明](docs/cross-platform.md#分屏)。

## 自定义快捷键

在“更多操作 → 快捷键设置…”或“设置 → 快捷键设置…”中配置。按标签页、分屏、编辑与搜索、显示与设置分组，共 19 个操作；点击右侧按键后直接按下新组合键，再点击“保存快捷键”。修改立即生效，重新启动后继续保留，工具栏提示同步更新。

- 支持 Ctrl、Alt、Shift、Meta 组合和 F1–F24；普通字符需搭配 Ctrl、Alt 或 Meta，避免占用 shell 输入。系统拦截的组合键可能无法送达应用。
- 重复绑定会显示冲突并阻止保存；可先清除原绑定或交换两项绑定。常见系统组合键及固定 Ctrl+C / Ctrl+V 别名不能绑定到其他操作。
- 每行右侧 × 清除绑定。“恢复默认”恢复整套默认值，仍需保存；“取消”或 Esc 放弃本次修改。录入时 Esc 仅取消录入，Tab 结束录入并移至下一控件，Delete / Backspace 清除当前绑定。
- Esc 保留给 Vim 等终端程序及弹窗、菜单、搜索的取消操作，不能绑定到关闭操作。“关闭面板或退出”默认未绑定，可自行设置其他组合键。旧配置中的 Esc 关闭绑定会在加载时自动清除，其他自定义快捷键保留；恢复默认也不会重新占用 Esc。此调整属于当前源码，已发布的 0.4.0 安装包需在快捷键设置中手动清除旧绑定。
- Ctrl+C 仍在有选区时复制、无选区时中断命令；Ctrl+V 仍可直接粘贴。外观设置的预览与快捷键保存互不覆盖。

界面预览：[深色](docs/images/shortcuts-dark.png) · [浅色](docs/images/shortcuts-light.png)。

## 异常退出恢复

终端被强制关闭、崩溃或系统意外退出后，下次启动会提示“恢复上次的终端？”。点击“恢复会话”，重建上次的标签顺序、名称、左右/上下嵌套分屏、比例、当前面板、Shell 和工作目录。

- 正常退出不触发恢复；未决定是否恢复就关闭窗口，记录仍会保留。Esc 不会丢弃恢复记录，只有明确点击“新建终端”才放弃当前记录。
- 每个窗口分别记录，仍在运行的窗口不会被当成异常退出。如果有多个异常退出窗口，每次启动先提示最近的一份，其他记录保留。
- 目录已删除或原 Shell 不可用时，使用主目录或默认 Shell，并显示恢复结果。
- 布局变动后约 200ms 保存；工作目录定期核对，异常前最后约 2 秒的变化可能尚未保存。恢复记录位于配置目录的 recovery 子目录。
- 恢复会启动新的 Shell，**不会续跑原进程、重放命令或恢复历史屏幕内容、未提交输入和临时环境变量**。

自定义快捷键与异常退出恢复从 0.4.0 开始提供。

## 发布与验证

[发布工作流](https://github.com/songyekun-614/terminal/actions/workflows/desktop.yml)在 Ubuntu x64 / ARM64、Windows x64 / ARM64 四个原生环境依次执行服务测试、真实 PTY / ConPTY 界面测试、安装包构建和打包后回归，全部通过才发布。IBus 中文输入专项需要额外桌面环境，不属于常规 CI 验证范围。

本次本地 Linux x64 验证：服务测试 32 项通过、1 项 Windows 专项跳过；实际安装版本界面测试 46 项通过、1 项 IBus 专项跳过。功能范围及故障注入测试见[快捷键验证](docs/2026-10-18-shortcuts-verification.md)与[异常恢复验证](docs/2026-10-18-recovery-verification.md)。0.4.0 的[发布工作流](https://github.com/songyekun-614/terminal/actions/runs/39109580777)已全部通过，详细结果见[发布验证记录](docs/2026-10-18-release-0.4.0-verification.md)。

Windows 安装包未签名，Windows 10、Fedora、Arch、openSUSE 尚需实机验证；安装、升级和卸载生命周期尚未完成验证。目前没有 macOS 安装包；SSH 管理、正常退出后的工作区自动恢复和在线更新尚未交付。各版本功能以对应 Release 发布说明为准。

## Windows / Linux 安装

日常使用安装包不需要安装 Node.js 或 Python。需要图形桌面；终端运行系统已有的 shell。

### 下载安装包与选择架构

推荐从 [GitHub Releases](https://github.com/songyekun-614/terminal/releases/latest) 的 **Assets** 下载对应系统和架构的安装包。Release 同时提供 `SHA256SUMS` 校验文件；页面自动生成的 Source code 压缩包是源码，不是安装包。

也可打开 [GitHub Actions 构建列表](https://github.com/songyekun-614/terminal/actions/workflows/desktop.yml)，选择成功的构建，在页面底部 **Artifacts** 下载对应系统和架构的压缩包，然后解压。下载 Actions 产物需要登录 GitHub，产物有保存期限。成功的四平台构建提供以下产物，当前版本的测试与发布记录见 [跨平台验证记录](docs/cross-platform-verification.md)：

| 系统 | Actions 产物 | 包内文件 |
| --- | --- | --- |
| Windows x64 | `terminal-win-x64` | `*-setup.exe` 安装器、便携程序 zip |
| Windows ARM64 | `terminal-win-arm64` | `*-setup.exe` 安装器、便携程序 zip |
| Linux x64 | `terminal-linux-x64` | AppImage、deb、rpm |
| Linux ARM64 | `terminal-linux-arm64` | AppImage、deb、rpm |

Windows 在“设置 → 系统 → 系统信息（关于）→ 系统类型”查看架构：Intel / AMD 的 64 位电脑选择 `x64`，ARM 电脑选择 `arm64`。Linux 运行 `uname -m`：`x86_64` 对应 `x64`，`aarch64` 对应 `arm64`。目前提供这两种架构。

以下命令以 **0.4.0 x64** 安装包为例，在下载文件所在目录执行；Windows ARM64 用户将文件名中的 `x64` 换成 `arm64`；Linux ARM64 的 AppImage/deb 使用 `arm64`，rpm 使用 `aarch64`。Linux x64 的 AppImage/rpm 使用 `x86_64`，deb 使用 `amd64`。其他版本按实际文件名修改。

### Windows

1. 从 Release 下载对应架构的安装器；使用 Actions 产物时先解压外层压缩包。
2. 双击 `terminal-0.4.0-windows-x64-setup.exe`，按提示选择安装目录。安装到当前用户，无需管理员权限。
3. 从开始菜单或桌面快捷方式启动 **terminal**。默认使用已安装的 PowerShell 7，否则使用 Windows PowerShell；可在外观设置中选择 cmd。

也可使用 zip 版本：解压下载的 `terminal-0.4.0-windows-x64.zip` 到当前用户可写的目录，双击其中的 `terminal.exe`。设置仍保存在用户配置目录。

当前安装包未签名，Windows 可能显示 SmartScreen 提示。请核对文件来自本仓库构建。兼容性目标为 Windows 10 x64 1809+、ARM64 1903+ 和 Windows 11；原生 CI 已验证 Windows Server 2022 x64 与 Windows 11 ARM64，Windows 10 尚未实机验证。

卸载安装版：在“设置 → 应用”中卸载 **terminal**；zip 版删除解压目录即可。卸载保留设置和已导入的壁纸。

### Debian / Ubuntu

推荐使用 deb 包，由包管理器安装所需运行库：

```bash
sudo apt install ./terminal-0.4.0-linux-amd64.deb
terminal
```

安装后也可从应用菜单启动。卸载：`sudo apt remove terminal`。

### Fedora / openSUSE

Fedora：

```bash
sudo dnf install ./terminal-0.4.0-linux-x86_64.rpm
terminal
```

openSUSE：

```bash
sudo zypper install ./terminal-0.4.0-linux-x86_64.rpm
terminal
```

卸载分别使用 `sudo dnf remove terminal` 或 `sudo zypper remove terminal`。

### Arch Linux 与其他 Linux 桌面发行版

使用对应架构的 AppImage，以普通桌面用户启动：

```bash
chmod +x terminal-0.4.0-linux-x86_64.AppImage
./terminal-0.4.0-linux-x86_64.AppImage
```

AppImage 可能需要 FUSE 2 兼容库（Ubuntu 22.04 为 `libfuse2`，Ubuntu 24.04 为 `libfuse2t64`）。没有 FUSE 时，可解压运行：

```bash
./terminal-0.4.0-linux-x86_64.AppImage --appimage-extract
./squashfs-root/AppRun
```

AppImage 不自动创建应用菜单入口，删除文件或解压目录即可卸载。系统需提供 GTK3、NSS、GBM、ALSA 等 Electron 运行库，并允许 Chromium sandbox；不要用 root 启动或关闭 sandbox。

Linux 已验证 Ubuntu 22.04 x64、Ubuntu 24.04 ARM64 和本地 Debian 13 x64。Fedora、Arch、openSUSE 尚未逐个实机验证；旧版发行版的 glibc 或桌面运行库可能不兼容。详细系统要求、配置位置和构建说明见 [跨平台使用说明](docs/cross-platform.md)。

### macOS

目前没有 macOS 安装包，也没有 macOS 构建与运行验证。项目名称和外观参考 Mac 终端；当前交付平台为 Windows 和 Linux。

## 从源码运行独立版本

从源码启动（需要 Node.js 22.12+、npm、Python 和平台 C++ 构建工具，依赖准备见 [跨平台使用说明](docs/cross-platform.md#从源码构建和验证)）：

```bash
git clone https://github.com/songyekun-614/terminal.git
cd terminal/desktop
npm ci
npm test
npm run build
npx electron-builder install-app-deps
npm start
```

发布构建会为目标系统、架构和 Electron 重建 `node-pty`。当前版本使用 Node-API；切换架构或升级原生依赖后应重新构建。日常使用已打包应用不需要安装 Node 或 Python；Linux 仍需要 Electron 使用的系统运行库。

## Linux 代理与 Codex 连接排查

从应用菜单启动终端时，桌面进程不一定包含 `http_proxy` / `https_proxy`。Linux 的 Electron 和 GTK 版本会在新建标签页时读取 GNOME 的**手动代理**设置，将有效的 HTTP、HTTPS、SOCKS 代理和绕过地址传给 shell 及其子进程。HTTPS 使用 HTTP CONNECT；SOCKS 使用 `socks5h://`。代理地址和端口来自用户的系统设置，不固定为某个软件或端口。

已有的代理环境变量优先，大小写变量互相补齐；显式设置的空值也会保留。缺少 GNOME 设置、`gsettings` 不可用或读取超时时，仍可正常打开终端。此功能不修改 `.bashrc` 或系统代理，也不自动重启其他程序。

此转换只支持 GNOME 手动代理。PAC/自动代理、其他桌面环境、Windows，以及需要认证的 HTTP 代理，请在 shell 配置中按网络环境显式设置代理变量。桌面代理密码不会复制到 shell 环境。系统代理变更后，请新建标签页；各命令行工具对 `NO_PROXY` 的支持可能不同。

如果 Codex 仍然反复提示超时，可能是它复用了**设置代理之前就已启动的后台服务**。旧进程不会自动获得新终端的环境变量。先确认新标签页中已有正确的 `https_proxy` / `HTTPS_PROXY`，在其他 Codex 任务结束后执行：

```bash
codex app-server daemon restart
codex doctor --summary
```

重启会断开共享该后台服务的客户端，请先结束相关任务。单次排查也可使用 `codex --no-daemon`，让该次会话直接使用当前终端环境。上述命令适用于支持共享后台服务的 Codex CLI 版本；旧版本请查阅 `codex --help`。代理服务本身仍需保持运行。

## 原有 GTK 版本

原有 Python / GTK4 / VTE 版本与启动入口保留，继续适用于 Debian 13。以下安装依赖、启动命令和功能说明描述该版本。

## GTK 版本安装依赖

在 Debian 13 上运行：

```bash
sudo apt update
sudo apt install python3-gi gir1.2-gtk-4.0 gir1.2-vte-3.91 libvte-2.91-gtk4-0
```

在克隆的项目目录运行：

```bash
cd terminal
./bin/mac-style-terminal
```

如需在 GNOME 应用列表中显示（脚本会写入项目的实际路径）：

```bash
python3 bin/install-launcher
```

安装脚本会检查运行依赖、校验桌面入口，并支持重复安装及包含空格的项目路径。新版入口可在项目移动后重新安装以更新路径；旧版未带管理标记的入口，请先卸载入口再移动项目。

桌面图标采用深灰圆角底板、红黄绿圆点与低饱和灰绿色提示符，安装到用户图标目录，应用列表、窗口和“关于”使用同一图标。[图标预览](docs/images/app-icon.png) · [SVG 源文件](mac_style_terminal/icons/io.github.macstyle.Terminal.svg)。

卸载用户级桌面入口：

```bash
python3 bin/uninstall-launcher
```

卸载移除本应用管理的桌面入口和图标，保留项目文件、设置和已导入的壁纸。之后可再次运行安装脚本恢复入口。

## GTK 版本功能

- 使用 `$SHELL` 指定的 shell；无效时回退至 `/bin/sh`。
- 会话使用 `TERM=xterm-256color`，启用 Debian 默认的绿色用户名提示符和 shell 彩色输出，不改写用户的 shell 配置。
- “外观设置 → 用户名与主机名颜色”提供绿色、蓝色、青色、橙色、粉色预设，也可用原生颜色选择器或 #RRGGBB / #RGB 色值自定义。用户名与主机名共用所选颜色，预览实时更新；应用后，当前空闲的 Bash 提示符立即变色，保留未提交的输入和光标位置，无需新建标签页。运行命令时在返回提示符后使用新颜色。保留用户 `.bashrc` 与已有提示符命令，其他 shell 使用其自身的提示符配置。
- 标签页可新增、切换、拖动排序和关闭。关闭运行中的会话时会提示。
- 双击顶部标签栏的空白处可新建标签页。
- 双击标签标题可重命名，也可使用右上角菜单或 Ctrl+Shift+R。名称不会被命令覆盖；留空恢复自动标题。
- 新标签页继承当前终端所在的本地目录。
- 可复制、粘贴、全选、搜索和调整字体大小。
- 在“外观设置”中选择 Pro、Basic、Homebrew 配色，并设置等宽字体和字号。字体菜单自动列出已安装的常用字体（如 DejaVu Sans Mono、Liberation Mono、Noto Mono），支持自定义名称；字体与字号可实时预览，点击“应用设置”后保存到所有标签页。
- “外观设置”提供 10 种背景预设、原生颜色选择器和十六进制色值输入（#RRGGBB / #RGB），可实时预览；背景保存后用于所有标签页，文字颜色会按背景亮度调整。
- 可在“外观设置 → 壁纸 → 导入图片”选择本地壁纸，并调整透明度（越高越淡）。应用后图片复制到配置目录，后续启动继续使用；“移除”恢复纯色背景。
- 设置保存在 `~/.config/mac-style-terminal/settings.json`。
- UI 按 `baseline-ui` 指南重新调整：统一深浅配色、圆角窗口与终端面板、胶囊式活动标签，以及柔和的留白。顶部显示“Stay focused / Start with a command”，悬停可查看目录和 shell 信息。标签宽度随标题调整；菜单和外观设置使用中文。
- 切换标签页后立即进入终端输入；标题刷新会合并处理，后台标签页的输出不会抢占当前标题和焦点。
- 标签页切换使用 180ms 的交叉淡入，快速连续切换可中断动画；遵循系统的动画开关。

| 操作 | 快捷键 |
| --- | --- |
| 新建标签页 | Ctrl+Shift+T |
| 重命名当前标签页 | Ctrl+Shift+R |
| 关闭标签页 | Ctrl+Shift+W |
| 切换标签页 | Ctrl+Page Up / Ctrl+Page Down |
| 复制 / 粘贴 | Ctrl+Shift+C / Ctrl+Shift+V |
| 搜索 | Ctrl+Shift+F |
| 放大 / 缩小 / 重置字号 | Ctrl++ / Ctrl+- / Ctrl+0 |
| 外观设置 | Ctrl+, |

## GTK 版本测试

界面预览：[深色](docs/images/ui-dark.png) · [浅色](docs/images/ui-light.png) · [外观设置](docs/images/preferences.png)。

```bash
python3 -m unittest discover -s tests -v
```

## 说明

外观取材于 Mac 终端的简洁布局和描述文件概念，不包含 Apple 图标、商标或 macOS 专有窗口控件。窗口边框由 Debian 桌面主题绘制。
