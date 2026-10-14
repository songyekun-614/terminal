# Cross-platform Terminal Implementation Plan

> **For agentic workers:** Use executing-plans for the main integration and subagent-driven-development for isolated UI and packaging tasks. Execute through verification without an approval pause: the user has resumed the previously approved adaptation.

**Goal:** Deliver a standalone terminal for Windows 10/11 and mainstream Linux on x64 and ARM64.

**Architecture:** Electron main process owns native PTYs and settings. A sandboxed renderer uses xterm.js and an explicit preload bridge. The existing GTK application remains available.

**Tech Stack:** Electron 44.7.2, node-pty 1.1.0, xterm 6.0.0, esbuild 0.28.2, electron-builder 26.15.3, Playwright 1.64.0.

**Spec:** docs/superpowers/specs/2026-10-14-cross-platform-terminal-design.md

## Global Constraints
- Windows 10 1809+ / Windows 11; Windows 10 ARM64 1903+.
- Linux and Windows: x64 and ARM64; SSH paused.
- Name terminal; header Stay focused / Start with a command; Chinese controls.
- Renderer sandboxed, contextIsolation true, nodeIntegration false; local CSP.
- No commands injected to refresh an idle prompt; no deletion of original wallpapers.
- Animation 180ms, transform/opacity only, prefers-reduced-motion honored.

### Task 1: Native services and bridge
Files: desktop/package.json, src/settings.cjs, src/shells.cjs, src/sessions.cjs, src/main.cjs, src/preload.cjs, assets/prompt.bash, assets/prompt.ps1, test/services.test.cjs.
Interfaces: normalizeSettings(value), readSettings(root), saveSettings(root,value), palette(settings); shellProfiles() returns {id,label,file,args}[]; Sessions.create({cwd,shell,cols,rows}) returns {id,pid,cwd,label,user,host}. Sessions.write/resize/ack/close check owned IDs. Bridge API: bootstrap() returns {settings,fonts,shells,platform,user,host}; createSession(options), write(id,data), resize(id,cols,rows), ack(id,bytes), closeSession(id), sessionInfo(id), saveSettings(value), importWallpaper(), wallpaper(), windowAction(action), confirmClose(), readClipboard(), writeClipboard(text), onOutput(callback), onExit(callback).
- [x] Write node:test assertions: malformed settings fall back; #RGB expands; atomic persistence roundtrips; temp wallpaper ownership; Linux and Windows shell commands use argv; real PTY handles Unicode output and resized dimensions.
- [x] Run `node --test desktop/test/services.test.cjs`, observe absent service failures.
- [x] Implement services using fs atomic rename, strict input validation, shell discovery and node-pty, backpressure 256KiB high/64KiB low.
- [x] Run node tests; integrate Electron main + preload and run real shell smoke.

### Task 2: Renderer
Files: desktop/renderer/index.html, app.js, style.css, appearance.js, prompt.js; desktop/test/desktop.spec.cjs.
Consumes bridge above; output event {id,data}, exit event {id,exitCode}; wallpaper() returns data URL or null; importWallpaper() returns {path,url} or null. windowAction close|minimize|maximize. sessionInfo returns {cwd,busy}. confirmClose returns boolean.
- [x] Write Electron Playwright test opening app, producing Unicode in PTY, adding/renaming/switching tabs, changing colors/font, searching output, closing a busy session with confirmation.
- [x] Run test before renderer, observe missing document/app.
- [x] Implement xterm rendering, fit/search addons, tabs, native dialog preferences, palette and wallpaper preview, idle prompt recolor, resize observers, output acknowledgments and shortcuts. Use textContent for titles; never interpret output as HTML.
- [x] Run integrated Playwright test with actual PTY and inspect screenshot.

### Task 3: Packaging and platform CI
Files: desktop/electron-builder.yml, desktop/scripts/build.cjs, desktop/assets/icon.png, icon.ico, .github/workflows/desktop.yml, docs/cross-platform.md; root README.md and .gitignore.
Consumes main entry src/main.cjs and bundle renderer/app.bundle.js. build script bundles JS and xterm CSS, assets are included directly in Electron package.
- [x] Configure npm scripts `build`, `start`, `test`, `test:e2e`, `pack`, `dist:linux`, `dist:win`.
- [x] Configure native runners ubuntu-22.04 x64, ubuntu-24.04-arm ARM64, windows-2022 x64 and windows-11-arm ARM64 with artifact upload. Test same architecture before packaging.
- [x] Document Windows installer/uninstaller, portable zip and Linux package installation/removal and retained settings.
- [x] Build local Linux unpacked/deb/AppImage/rpm and run packaged smoke; inspect package contents and icon metadata.

### Task 4: Integration and review
Files: tests and implementation from all tasks, README.md.
- [x] Run legacy Python suite and all native/service and Electron end-to-end tests.
- [x] Review cross-platform path handling, IPC validation, shell lifecycle and packaging. Fix important findings and retest affected behavior.
- [x] Record exact local artifacts and tested platforms; finish with Windows/ARM64 verification limitations stated clearly.

## Execution results

Implemented on branch `feature/cross-platform-terminal`. Native Windows and Linux ARM64 runtime verification remains external to this Debian environment. Exact local artifacts, test counts, reviewed fixes and platform limits are recorded in `docs/cross-platform-verification.md`. No remote publication was performed.
