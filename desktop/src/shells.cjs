"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
function executable(file) {
  try {
    fs.accessSync(
      file,
      process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
    );
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
function onPath(name) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const file = path.join(dir, name);
    if (executable(file)) return file;
  }
  return null;
}
function shellProfiles() {
  if (process.platform === "win32") {
    const system = process.env.SystemRoot || "C:\\Windows";
    const candidates = [
      { id: "pwsh", label: "PowerShell 7", file: onPath("pwsh.exe") },
      {
        id: "powershell",
        label: "Windows PowerShell",
        file: path.join(
          system,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
      },
      {
        id: "cmd",
        label: "Command Prompt",
        file: process.env.ComSpec || path.join(system, "System32", "cmd.exe"),
      },
    ];
    return candidates.filter((s) => s.file && executable(s.file));
  }
  const userShell = process.env.SHELL || os.userInfo().shell;
  const names = [
    userShell,
    "/bin/bash",
    onPath("zsh"),
    onPath("fish"),
    "/bin/sh",
  ];
  const files = [
    ...new Set(names.filter((s) => s && path.isAbsolute(s) && executable(s))),
  ];
  return files
    .map((file) => ({
      id: path.basename(file),
      label: path.basename(file) === "bash" ? "Bash" : path.basename(file),
      file,
    }))
    .filter((s, i, a) => a.findIndex((v) => v.id === s.id) === i);
}
function commandFor(profile, assets, platform = process.platform) {
  let args = [];
  if (platform === "win32") {
    if (profile.id === "cmd") args = ["/D", "/Q"];
    else
      args = [
        "-NoLogo",
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(assets, "prompt.ps1"),
      ];
  } else if (path.basename(profile.file) === "bash")
    args = ["--rcfile", path.join(assets, "prompt.bash")];
  return { file: profile.file, args };
}
module.exports = { shellProfiles, commandFor, executable };
