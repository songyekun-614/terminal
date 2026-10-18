"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
function validId(value) { return typeof value === "string" && /^[a-z\d-]{1,80}$/i.test(value); }
function validateWorkspace(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.tabs) || !value.tabs.length || value.tabs.length > 40) throw Error("恢复记录的标签页无效");
  const tabIds = new Set(), paneIds = new Set();
  function layout(node, depth, localIds) {
    if (!node || typeof node !== "object" || depth > 8) throw Error("恢复记录的分屏层级无效");
    if (node.type === "pane") {
      if (!validId(node.id) || paneIds.has(node.id) || paneIds.size >= 40) throw Error("恢复记录的面板无效");
      if (typeof node.cwd !== "string" || node.cwd.length > 4096 || node.cwd.includes("\0") || !path.isAbsolute(node.cwd)) throw Error("恢复记录的工作目录无效");
      if (typeof node.shell !== "string" || !/^[a-z\d_-]{0,40}$/i.test(node.shell)) throw Error("恢复记录的 Shell 无效");
      paneIds.add(node.id); localIds.add(node.id);
      return { type: "pane", id: node.id, cwd: node.cwd, shell: node.shell };
    }
    if (node.type !== "split" || !["horizontal", "vertical"].includes(node.direction) || !Number.isInteger(node.ratio) || node.ratio < 15 || node.ratio > 85) throw Error("恢复记录的分屏比例无效");
    return { type: "split", direction: node.direction, ratio: node.ratio,
      first: layout(node.first, depth + 1, localIds), second: layout(node.second, depth + 1, localIds) };
  }
  const tabs = value.tabs.map(tab => {
    if (!tab || !validId(tab.id) || tabIds.has(tab.id) || typeof tab.title !== "string" || tab.title.length > 80) throw Error("恢复记录的标签名称无效");
    tabIds.add(tab.id);
    const localIds = new Set(), tree = layout(tab.layout, 0, localIds);
    if (!localIds.has(tab.activePane)) throw Error("恢复记录的当前面板无效");
    return { id: tab.id, title: tab.title, activePane: tab.activePane, layout: tree };
  });
  if (!tabIds.has(value.activeTab)) throw Error("恢复记录的当前标签无效");
  return { version: 1, activeTab: value.activeTab, tabs };
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (err) { return err.code !== "ESRCH"; }
}
function processIdentity(pid) {
  try {
    if (process.platform === "linux") {
      const boot = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const started = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
      return started ? `linux:${boot}:${started}` : null;
    }
    if (process.platform === "win32") {
      const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const ticks = execFileSync(executable, ["-NoProfile", "-NonInteractive", "-Command",
        `[Console]::Write([Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks)`],
        { encoding: "utf8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
      return /^\d+$/.test(ticks) ? `win32:${ticks}` : null;
    }
  } catch {}
  return null;
}
function identityHash(identity, pid) {
  return crypto.createHash("sha256").update(identity || `pid:${pid}`).digest("hex").slice(0, 16);
}
let reportedDirectorySyncFailure = false;
function syncDirectory(directory) {
  if (process.platform === "win32") return;
  let fd;
  try { fd = fs.openSync(directory, "r"); fs.fsyncSync(fd); }
  catch (err) {
    // Rename/unlink has already committed. A directory flush is best effort on
    // filesystems that do not support it; never report the committed action as failed.
    if (!reportedDirectorySyncFailure) {
      reportedDirectorySyncFailure = true;
      console.warn("Recovery directory sync unavailable:", err.message);
    }
  } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
}
class RecoveryStore {
  constructor(root, { pid = process.pid, alive = processAlive, identity = processIdentity } = {}) {
    this.directory = path.join(root, "recovery");
    this.pid = pid; this.alive = alive; this.identity = identity;
    this.ownerIdentity = identity(pid);
    this.id = crypto.randomUUID();
    this.file = path.join(this.directory, `window-${pid}-${identityHash(this.ownerIdentity, pid)}-${this.id}.json`);
    this.pending = false; this.closed = false; this.workspace = null; this.updatedAt = null;
  }
  write(workspace, updatedAt = new Date().toISOString()) {
    const temp = path.join(this.directory, `.recovery-${crypto.randomUUID()}`);
    let fd;
    try {
      fd = fs.openSync(temp, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify({ version: 1, pid: this.pid, processIdentity: this.ownerIdentity, updatedAt, workspace }) + "\n");
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, this.file);
      this.workspace = workspace; this.updatedAt = updatedAt;
      syncDirectory(this.directory);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temp); } catch {}
    }
  }
  begin() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const candidates = [];
    for (const name of fs.readdirSync(this.directory)) {
      const match = /^window-(\d+)-(?:(\b[\da-f]{16})-)?[\da-f-]+\.json$/.exec(name);
      if (!match) continue;
      const ownerPid = Number(match[1]);
      // The claimed filename carries its new owner's start identity before the JSON rewrite.
      if (this.alive(ownerPid)) {
        if (!match[2] || match[2] === identityHash(null, ownerPid)) continue;
        const identity = this.identity(ownerPid);
        if (!identity || identityHash(identity, ownerPid) === match[2]) continue;
      }
      const file = path.join(this.directory, name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > 1024 * 1024) continue;
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (data.version !== 1 || !Number.isFinite(Date.parse(data.updatedAt)) || !data.workspace) continue;
        candidates.push({ file, workspace: validateWorkspace(data.workspace), updatedAt: data.updatedAt });
      } catch {}
    }
    candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    for (const record of candidates) {
      try { fs.renameSync(record.file, this.file); }
      catch (err) { if (err.code === "ENOENT") continue; throw err; }
      this.pending = true;
      this.write(record.workspace, record.updatedAt);
      return { workspace: this.workspace, updatedAt: this.updatedAt };
    }
    this.write(null);
    return null;
  }
  save(value) {
    if (this.closed) return false;
    const workspace = validateWorkspace(value);
    if (!this.pending && JSON.stringify(workspace) === JSON.stringify(this.workspace)) return false;
    this.write(workspace); this.pending = false;
    return true;
  }
  discardPending() {
    if (this.closed) return;
    this.write(null); this.pending = false;
  }
  finishClean() {
    this.closed = true;
    // An unanswered recovery prompt is not permission to discard the old workspace.
    if (this.pending) return;
    try { fs.unlinkSync(this.file); syncDirectory(this.directory); } catch (err) { if (err.code !== "ENOENT") throw err; }
  }
}
module.exports = { RecoveryStore, validateWorkspace };
