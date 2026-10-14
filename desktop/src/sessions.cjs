"use strict";
const pty = require("node-pty");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { fileURLToPath } = require("node:url");
const { shellProfiles, commandFor } = require("./shells.cjs");
const HIGH = 256 * 1024,
  LOW = 64 * 1024;
function dimensions(cols, rows) {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 2 ||
    rows < 1 ||
    cols > 1000 ||
    rows > 1000
  )
    throw new Error("终端尺寸无效");
}
class Sessions {
  constructor({ root, assets, onOutput, onExit }) {
    this.root = root;
    this.assets = assets;
    this.onOutput = onOutput;
    this.onExit = onExit;
    this.items = new Map();
    this.profiles = shellProfiles();
  }
  get(id) {
    const s = this.items.get(id);
    if (!s) throw new Error("终端会话不存在");
    return s;
  }
  create({ cwd, shell, cols = 80, rows = 24 } = {}) {
    dimensions(cols, rows);
    if (this.items.size >= 40) throw new Error("最多可打开 40 个终端标签页");
    const profile =
      this.profiles.find((s) => s.id === shell) ||
      (!shell ? this.profiles[0] : null);
    if (!profile) throw new Error("所选 shell 不可用");
    if (
      typeof cwd !== "string" ||
      !path.isAbsolute(cwd) ||
      !fs.existsSync(cwd) ||
      !fs.statSync(cwd).isDirectory()
    )
      cwd = os.homedir();
    const command = commandFor(profile, this.assets),
      env = {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        MAC_STYLE_TERMINAL_SETTINGS: path.join(this.root, "settings.json"),
      };
    // Electron-only variables must not leak into user Node programs in the shell.
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    delete env.NODE_CHANNEL_FD;
    if (process.platform === "win32" && profile.id === "cmd")
      env.PROMPT =
        "$E[32m" + os.userInfo().username + "@" + os.hostname() + "$E[0m $P$G ";
    const terminal = pty.spawn(command.file, command.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
      useConpty: process.platform === "win32",
      ...(process.platform === "win32" ? {} : { encoding: "utf8" }),
      handleFlowControl: false,
    });
    const id = crypto.randomUUID(),
      s = {
        id,
        terminal,
        cwd,
        pid: terminal.pid,
        label: profile.label,
        busy: true,
        unacked: 0,
        paused: false,
        oscTail: "",
        closing: false,
      };
    this.items.set(id, s);
    terminal.onData((data) => {
      this.track(s, data);
      s.unacked += Buffer.byteLength(data);
      if (s.unacked > HIGH && !s.paused) {
        terminal.pause();
        s.paused = true;
      }
      this.onOutput({ id, data });
    });
    terminal.onExit(({ exitCode }) => {
      this.items.delete(id);
      this.onExit({ id, exitCode });
    });
    return {
      id,
      pid: s.pid,
      cwd,
      label: s.label,
      user:
        process.platform === "win32"
          ? process.env.USERNAME || os.userInfo().username
          : os.userInfo().username,
      host:
        process.platform === "win32"
          ? process.env.COMPUTERNAME || os.hostname()
          : os.hostname(),
    };
  }
  track(s, data) {
    const text = s.oscTail + data;
    const pattern = /\x1b\](7|666);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    for (const match of text.matchAll(pattern)) {
      if (match[1] === "666" && match[2] === "vte.ext.macstyle.prompt-idle=1")
        s.busy = false;
      if (match[1] === "666" && match[2] === "vte.ext.macstyle.prompt-idle=0")
        s.busy = true;
      if (match[1] === "7") {
        try {
          const url = new URL(match[2]);
          if (url.protocol !== "file:") continue;
          const directory = fileURLToPath(url);
          if (
            path.isAbsolute(directory) &&
            fs.existsSync(directory) &&
            fs.statSync(directory).isDirectory()
          )
            s.cwd = directory;
        } catch {}
      }
    }
    const last = text.lastIndexOf("\x1b]");
    s.oscTail =
      last >= 0 && !/[\x07]|\x1b\\/.test(text.slice(last + 2))
        ? text.slice(last).slice(-8192)
        : text.endsWith("\x1b")
          ? "\x1b"
          : "";
  }
  write(id, data) {
    const s = this.get(id);
    if (typeof data !== "string" || data.length > 1024 * 1024)
      throw new Error("终端输入无效");
    if (data.includes("\r") || data.includes("\n")) s.busy = true;
    s.terminal.write(data);
  }
  resize(id, cols, rows) {
    dimensions(cols, rows);
    this.get(id).terminal.resize(cols, rows);
  }
  ack(id, bytes) {
    const s = this.items.get(id);
    if (!s) return;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 16 * 1024 * 1024)
      throw new Error("输出确认无效");
    s.unacked = Math.max(0, s.unacked - bytes);
    if (s.paused && s.unacked < LOW) {
      s.terminal.resume();
      s.paused = false;
    }
  }
  info(id) {
    const s = this.get(id);
    if (process.platform === "linux") {
      try {
        s.cwd = fs.readlinkSync(`/proc/${s.pid}/cwd`);
      } catch {}
    }
    return { cwd: s.cwd, busy: s.busy };
  }
  close(id) {
    const s = this.get(id);
    s.closing = true;
    if (s.paused) s.terminal.resume();
    s.terminal.kill();
  }
  dispose() {
    for (const s of this.items.values()) {
      try {
        s.terminal.kill();
      } catch {}
    }
    this.items.clear();
  }
}
module.exports = { Sessions, dimensions };
