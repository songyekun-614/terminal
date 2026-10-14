"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  nativeImage,
  Menu,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const {
  normalizeSettings,
  readSettings,
  saveSettings,
  ownedWallpaper,
} = require("./settings.cjs");
const { Sessions } = require("./sessions.cjs");
app.setName("terminal");
Menu.setApplicationMenu(null);
let window,
  sessions,
  root,
  closing = false;
const base = path.join(__dirname, ".."),
  assets = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "assets")
    : path.join(base, "assets");
const selectedImages = new Set(),
  stagedImages = new Set();
function discardWallpapers(keep = null) {
  for (const file of stagedImages) {
    if (file !== keep && ownedWallpaper(root, file)) {
      try {
        const real = fs.realpathSync(file);
        if (ownedWallpaper(fs.realpathSync(root), real)) {
          fs.unlinkSync(real);
          fs.rmdirSync(path.dirname(file));
        }
      } catch {}
    }
  }
  stagedImages.clear();
}
function fonts() {
  if (process.platform === "win32")
    return new Promise((resolve) => {
      const executable = path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const code =
        "$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules') + ';' + $env:PSModulePath; " +
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts' | Select-Object -ExpandProperty PSObject | Select-Object -ExpandProperty Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $_.Name -replace ' \\(.*\\)$','' }";
      execFile(
        executable,
        ["-NoProfile", "-NonInteractive", "-Command", code],
        { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true },
        (error, stdout) => {
          const available = error
            ? []
            : stdout
                .split("\n")
                .map((v) => v.trim())
                .filter(Boolean);
          const preferred = [
            "Consolas",
            "Cascadia Mono",
            "Cascadia Code",
            "Courier New",
            "Lucida Console",
          ];
          resolve(
            [
              ...new Set([
                ...preferred.filter((n) => available.includes(n)),
                ...available,
              ]),
            ].length
              ? [
                  ...new Set([
                    ...preferred.filter((n) => available.includes(n)),
                    ...available,
                  ]),
                ]
              : preferred,
          );
        },
      );
    });
  return new Promise((resolve) =>
    execFile(
      "fc-list",
      [":spacing=100", "family"],
      { timeout: 3000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const names = error
          ? []
          : stdout
              .split("\n")
              .flatMap((s) => s.split(","))
              .map((s) => s.trim())
              .filter(Boolean);
        resolve([...new Set(["Monospace", ...names])].sort());
      },
    ),
  );
}
function checked(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("未授权的窗口");
}
function handle(name, fn) {
  ipcMain.handle("terminal:" + name, (event, ...args) => {
    checked(event);
    return fn(...args);
  });
}
async function confirmClose() {
  const result = await dialog.showMessageBox(window, {
    type: "question",
    title: "关闭终端",
    message: "终端中可能有正在运行的命令。",
    detail: "关闭会终止这些会话。",
    buttons: ["取消", "关闭"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}
function imageData(file) {
  if (
    !file ||
    typeof file !== "string" ||
    (!ownedWallpaper(root, file) && !selectedImages.has(file))
  )
    return null;
  try {
    // Resolve symbolic links to avoid exposing paths outside managed wallpaper storage.
    const real = fs.realpathSync(file);
    if (
      !selectedImages.has(file) &&
      !ownedWallpaper(fs.realpathSync(root), real)
    )
      return null;
    if (fs.statSync(real).size > 25 * 1024 * 1024) return null;
    const image = nativeImage.createFromPath(real);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    return image.resize({ width: Math.min(size.width, 2560) }).toDataURL();
  } catch {
    return null;
  }
}
function installHandlers() {
  handle("bootstrap", async () => ({
    settings: {
      ...readSettings(root),
      shell: sessions.profiles.some((p) => p.id === readSettings(root).shell)
        ? readSettings(root).shell
        : "",
    },
    fonts: await fonts(),
    shells: sessions.profiles.map(({ id, label }) => ({ id, label })),
    platform: process.platform,
    user: os.userInfo().username,
    host: os.hostname(),
  }));
  handle("createSession", (options) => sessions.create(options));
  handle("write", (id, data) => sessions.write(id, data));
  handle("resize", (id, cols, rows) => sessions.resize(id, cols, rows));
  handle("ack", (id, bytes) => sessions.ack(id, bytes));
  handle("sessionInfo", (id) => sessions.info(id));
  handle("closeSession", (id) => sessions.close(id));
  handle("confirmClose", confirmClose);
  handle("readClipboard", () => clipboard.readText());
  handle("writeClipboard", (text) => {
    if (typeof text !== "string" || text.length > 4 * 1024 * 1024)
      throw new Error("剪贴板内容无效");
    clipboard.writeText(text);
  });
  handle("wallpaper", (file) =>
    imageData(file || readSettings(root).wallpaper),
  );
  handle("discardWallpapers", () => discardWallpapers());
  handle("importWallpaper", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "导入壁纸",
      properties: ["openFile"],
      filters: [
        { name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    selectedImages.add(source);
    const url = imageData(source);
    if (!url) {
      selectedImages.delete(source);
      throw new Error("无法读取图片，请选择小于 25 MB 的有效图片");
    }
    const dir = path.join(root, "wallpapers", crypto.randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const destination = path.join(dir, path.basename(source));
    try {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    } finally {
      selectedImages.delete(source);
    }
    stagedImages.add(destination);
    return { path: destination, url };
  });
  handle("saveSettings", (value) => {
    const normalized = normalizeSettings(value);
    if (normalized.wallpaper && !imageData(normalized.wallpaper))
      normalized.wallpaper = null;
    const previous = readSettings(root),
      next = saveSettings(root, normalized);
    // Only owned files are removed; the imported source file is never touched.
    if (
      previous.wallpaper &&
      previous.wallpaper !== next.wallpaper &&
      ownedWallpaper(root, previous.wallpaper)
    ) {
      try {
        const old = fs.realpathSync(previous.wallpaper);
        if (ownedWallpaper(fs.realpathSync(root), old)) fs.unlinkSync(old);
      } catch {}
    }
    discardWallpapers(next.wallpaper);
    return next;
  });
  handle("windowAction", async (action) => {
    if (action === "minimize") window.minimize();
    else if (action === "maximize") {
      window.isMaximized() ? window.unmaximize() : window.maximize();
    } else if (action === "close") window.close();
    else throw new Error("窗口操作无效");
  });
}
app
  .whenReady()
  .then(() => {
    root =
      process.env.TERMINAL_CONFIG_ROOT ||
      (process.platform === "linux"
        ? path.join(
            process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
            "mac-style-terminal",
          )
        : app.getPath("userData"));
    fs.mkdirSync(root, { recursive: true });
    if (!fs.existsSync(path.join(root, "settings.json")))
      saveSettings(root, readSettings(root));
    window = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 560,
      minHeight: 360,
      title: "terminal",
      frame: false,
      backgroundColor: "#24262b",
      icon: path.join(assets, "icon.png"),
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    sessions = new Sessions({
      root,
      assets,
      onOutput: (value) => {
        if (!window.isDestroyed())
          window.webContents.send("terminal:output", value);
      },
      onExit: (value) => {
        if (!window.isDestroyed())
          window.webContents.send("terminal:exit", value);
      },
    });
    installHandlers();
    window.webContents.on("render-process-gone", () => {
      closing = true;
      sessions.dispose();
      app.quit();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_, __, callback) =>
      callback(false),
    );
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.on("close", (event) => {
      if (closing) return;
      if ([...sessions.items.values()].some((s) => s.busy)) {
        event.preventDefault();
        if (window._confirming) return;
        window._confirming = true;
        confirmClose()
          .then((ok) => {
            window._confirming = false;
            if (ok) {
              closing = true;
              window.close();
            }
          })
          .catch(() => {
            window._confirming = false;
          });
      } else closing = true;
    });
    window.on("closed", () => {
      sessions.dispose();
      discardWallpapers();
    });
    let loaded = false;
    window.webContents.on("did-finish-load", () => {
      loaded = true;
    });
    window.webContents.on(
      "did-start-navigation",
      (_, __, isInPlace, isMainFrame) => {
        if (loaded && isMainFrame && !isInPlace) sessions.dispose();
      },
    );
    window.once("ready-to-show", () => window.show());
    window.loadFile(path.join(base, "renderer", "index.html"));
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (closing && sessions) sessions.dispose();
});
