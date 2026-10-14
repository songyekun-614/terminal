# Cross-platform terminal

## Scope
Resume the previously approved Windows and Linux adaptation. Target Windows 10 (1809 or newer) and Windows 11, Debian/Ubuntu, Fedora, Arch and openSUSE, on x64 and ARM64. Windows ARM64 validation uses Windows 11; Windows 10 ARM64 requires 1903 or newer. SSH remains paused.

## Architecture
Keep the GTK application available and add a standalone Electron application in `desktop/`. Electron provides consistent UI, xterm.js renders terminal sequences and node-pty provides POSIX PTYs and Windows ConPTY. Choose this over GTK on Windows because native PTY integration and standalone packaging are substantially more reliable; choose it over a new Rust/Tauri backend to reuse mature node-pty integration and reduce migration risk. The cost is a larger installation footprint.

The main process owns settings, native dialogs, fonts and PTYs. An isolated, sandboxed renderer uses a narrow preload bridge. No renderer Node access, remote content, unchecked navigation or arbitrary subprocess execution. PTY output is acknowledged after rendering with bounded outstanding output. Sessions are closed when their window closes.

## UI and features
Preserve the existing rounded design, muted icon, English header (Stay focused / Start with a command), Chinese menus, adaptive pill tabs, double-click tab rename and empty-space new tab, reorder, close confirmation, terminal shortcuts, search, fonts, three palettes, ten background presets and custom colors, wallpaper import and opacity. Respect reduced motion and keep transitions at 180ms. Settings apply to all tabs immediately. Preserve custom tab titles against OSC title changes.

Linux Bash retains the existing startup integration and prompt colors. Windows defaults to installed PowerShell 7 or Windows PowerShell, with cmd selectable. PowerShell adds a shared username/hostname color without editing the user's profile. Color updates redraw only the current idle prompt; busy shells are never sent injected refresh commands. Shell choice applies to new tabs. New tabs inherit active directory when available.

Linux reads existing ~/.config/mac-style-terminal settings and wallpapers. Windows uses Electron userData. Save atomically; import wallpapers into owned storage and never delete the original. Remove only owned imported images. Terminal text chooses adequate contrast on custom backgrounds.

## Distribution and verification
Provide AppImage, deb and rpm for both Linux architectures, NSIS installer and zip for both Windows architectures, using original SVG-derived PNG/ICO icons. Native builds and smoke tests run on matching GitHub runners; never claim Windows/ARM64 verified solely from Debian results. Current machine verifies Linux x64 PTY input/output/resize, Unicode, tabs, settings and real packaged app. Document supported OS floors and runtime dependencies; AppImage may require FUSE or extraction. Unsigned Windows binaries may show SmartScreen.
