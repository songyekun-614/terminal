# terminal

一款供 Debian 13 使用的独立终端。界面参考 Mac 自带终端的简洁布局，终端内核使用 GNOME VTE，因此运行的是真实 shell，而非模拟输入框。

## 安装依赖

在 Debian 13 上运行：

```bash
sudo apt update
sudo apt install python3-gi gir1.2-gtk-4.0 gir1.2-vte-3.91 libvte-2.91-gtk4-0
```

项目目录可放在 `/home/song/Projects/mac-style-terminal`。运行：

```bash
cd /home/song/Projects/mac-style-terminal
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

## 功能

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

## 测试

界面预览：[深色](docs/images/ui-dark.png) · [浅色](docs/images/ui-light.png) · [外观设置](docs/images/preferences.png)。

```bash
python3 -m unittest discover -s tests -v
```

## 说明

外观取材于 Mac 终端的简洁布局和描述文件概念，不包含 Apple 图标、商标或 macOS 专有窗口控件。窗口边框由 Debian 桌面主题绘制。
