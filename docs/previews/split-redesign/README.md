# 分屏设计预览

状态：用户已确认 B 版（12px 圆角、2px 接缝），已落地到产品源码；A/C/D 保留作设计过程参考。

本页使用项目现有 xterm.js 渲染器与分屏逻辑，浏览器端 `bridge.js` 提供演示输出，不创建 PTY、不执行命令、不保存配置。`redesign.css` 保留各版设计对比。

根据用户对 12px、6px 版本的反馈，提供四种可即时切换的方案：

| 方案 | 面板间距 | 面板圆角 | 接缝表现 |
| --- | --- | --- | --- |
| A 微距圆角 | 4px | 10px | 独立面板与短拖柄 |
| B 紧凑圆角（当前默认） | 2px | 12px | 更紧凑的面板与短拖柄 |
| C 极细接缝 | 1px | 6px | 无常驻面板边框，悬停显示短柄 |
| D 连续画布 | 0px | 0px | 无留缝，用覆盖式低对比 1px 细线分隔 |

各版本的可拖动区域均为 12px，并保留键盘调节。分屏拖动根据指针位置与实际容器大小计算比例，适配各版间距。切换版本保留当前布局与比例。当前面板使用标题背景和“当前”文字提示焦点；A/B 还提供轻边缘提示。窄窗口下分屏工具恢复为独立一行，终端内容区不使用模糊效果。

## v0.2.2 基准

`build.cjs` 从 Git 标签 `v0.2.2` 读取样式，只替换原来的单面板布局规则，并引入当前分屏布局。全局界面使用 `system-ui, sans-serif`、13px；终端使用该版本默认的 `Monospace`、12px。原有设置、搜索、重命名和关于窗口直接复用项目 HTML。

初始核对结果：改版前的 `desktop/src/`、`appearance.js` 和 `prompt.js` 与 v0.2.2 无差异。落地时保留原字体、原生确认窗口样式和文案，将确认范围扩展到每次关闭标签页及窗口。网页退出确认只是文案示意，不能表示系统原生窗口的实际外观。

预览使用 v0.2.2 的 Monospace、12px 默认基准。本机已备份原配置并从 16px 恢复为 12px，其余个性化配置保留，详见[安装及验证记录](../../2026-10-18-b-split-verification.md)。

## 启动

在项目根目录运行：

```sh
node docs/previews/split-redesign/build.cjs
python3 -m http.server 4178 --bind 127.0.0.1 --directory docs/previews/split-redesign
```

访问 <http://127.0.0.1:4178/>。编译文件已在此目录的 `.gitignore` 中排除。

## 设计依据

应用 [apple-design skill](https://github.com/dickwu/apple-design-skill)，读取桌面设计、布局、无障碍、字体、配色、分屏、工具栏、焦点与深色模式参考。

[Apple HIG Split views](https://developer.apple.com/design/human-interface-guidelines/split-views) 建议支持拖动调整、合理尺寸与细分隔线。四种接缝方案是针对用户反馈作出的设计选择，并非 Apple 的强制规范。

## 验证范围

使用 Electron 的 Chromium 引擎检查预览页面：左右面板几何位置不重叠；上下、嵌套和单面板布局；拖动与键盘调整；新旧方案切换；默认字体值；设置与退出文案示意；浅色与窄窗口。此验证不代表真实 PTY、操作系统原生对话框或安装包回归验证。
