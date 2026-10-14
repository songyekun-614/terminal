const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const settingsFile = path.join(__dirname, "../src/settings.cjs");
const shellsFile = path.join(__dirname, "../src/shells.cjs");
const sessionsFile = path.join(__dirname, "../src/sessions.cjs");

// Changes removing validation, owned-path checks, real PTY IO or resize break these tests.
test("native settings service exists", () =>
  assert.ok(fs.existsSync(settingsFile)));
test("settings sanitize corrupted values, expand colors and persist atomically", () => {
  if (!fs.existsSync(settingsFile))
    return assert.fail("settings implementation missing");
  const {
    normalizeSettings,
    readSettings,
    saveSettings,
    palette,
    ownedWallpaper,
  } = require(settingsFile);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-settings-"));
  try {
    const value = normalizeSettings({
      profile: "missing",
      font_size: true,
      background: "#abc",
      username_color: "bad",
      wallpaper_opacity: Infinity,
    });
    assert.equal(value.profile, "Pro");
    assert.equal(value.font_size, 12);
    assert.equal(value.background, "#aabbcc");
    assert.equal(value.username_color, "#28c840");
    assert.equal(value.wallpaper_opacity, 0.35);
    saveSettings(root, { ...value, font_size: 18 });
    assert.equal(readSettings(root).font_size, 18);
    fs.writeFileSync(path.join(root, "settings.json"), "{broken");
    assert.equal(readSettings(root).font_size, 12);
    assert.equal(
      palette(normalizeSettings({ background: "#fff" })).foreground,
      "#242528",
    );
    assert.equal(
      ownedWallpaper(root, path.join(root, "wallpapers", "abc", "image.png")),
      true,
    );
    assert.equal(
      ownedWallpaper(
        root,
        path.join(root, "wallpapers", "..", "settings.json"),
      ),
      false,
    );
    assert.equal(
      ownedWallpaper(root, path.join(root, "wallpapers-foreign", "x.png")),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("platform shell arguments preserve paths and choose Windows PowerShell / cmd without shell strings", () => {
  if (!fs.existsSync(shellsFile))
    return assert.fail("shell implementation missing");
  const { commandFor } = require(shellsFile);
  const assets = path.join(os.tmpdir(), "assets with spaces");
  const bash = commandFor(
    { id: "bash", file: "/bin/bash", label: "Bash" },
    assets,
    "linux",
  );
  assert.deepEqual(bash.args, ["--rcfile", path.join(assets, "prompt.bash")]);
  const win = commandFor(
    {
      id: "powershell",
      file: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    },
    assets,
    "win32",
  );
  assert.equal(win.args.at(-1), path.join(assets, "prompt.ps1"));
  assert.ok(win.args.includes("-NoExit"));
  assert.deepEqual(
    commandFor({ id: "cmd", file: "cmd.exe" }, assets, "win32").args,
    ["/D", "/Q"],
  );
});
test("PTY runs a real shell, supports Unicode/resize, rejects invalid input and closes cleanly", async (t) => {
  if (!fs.existsSync(sessionsFile))
    return assert.fail("PTY implementation missing");
  const { Sessions } = require(sessionsFile);
  let output = "";
  let exited;
  const exitPromise = new Promise((resolve) => {
    exited = resolve;
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-pty-"));
  const sessions = new Sessions({
    root,
    assets: path.join(__dirname, "../assets"),
    onOutput: (e) => {
      output += e.data;
      sessions.ack(e.id, Buffer.byteLength(e.data));
    },
    onExit: exited,
  });
  let failure;
  try {
    const shell = process.platform === "win32" ? "powershell" : "bash";
    const s = sessions.create({ shell, cwd: root, cols: 80, rows: 24 });
    assert.ok(s.pid > 0);
    assert.equal(s.cwd, root);
    assert.throws(() => sessions.write("foreign", "x"));
    assert.throws(() => sessions.resize(s.id, 0, 24));
    sessions.resize(s.id, 93, 31);
    const command =
      process.platform === "win32"
        ? "[Console]::WriteLine('PTY_日本語_✓'); [Console]::WriteLine(('SIZE_' + [Console]::WindowWidth))"
        : "printf 'PTY_日本語_✓\\n'; printf 'SIZE_'; stty size";
    sessions.write(s.id, command + "\r");
    const until = Date.now() + 15000;
    while (
      !output.includes(process.platform === "win32" ? "SIZE_93" : "31 93") ||
      !output.includes("PTY_日本語_✓")
    ) {
      if (Date.now() > until)
        assert.fail(
          "PTY did not produce resized Unicode output: " + output.slice(-1500),
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    sessions.write(s.id, "exit\r");
    await Promise.race([
      exitPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PTY did not exit")), 10000),
      ),
    ]);
    assert.equal(sessions.items.size, 0);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    sessions.dispose();
    try {
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      if (!failure) throw error;
      t.diagnostic("PTY cleanup also failed: " + error.message);
    }
  }
});
test("split OSC state tracks idle/busy and directories without partial marker confusion", () => {
  const { Sessions } = require(sessionsFile);
  const s = { busy: true, cwd: os.tmpdir(), oscTail: "" };
  const state = Object.create(Sessions.prototype);
  state.track(s, "\x1b]666;vte.ext.macstyle.prompt-id");
  assert.equal(s.busy, true);
  state.track(s, "le=1\x1b\\user@host> ");
  assert.equal(s.busy, false);
  state.track(s, "\x1b]666;vte.ext.macstyle.prompt-idle=0\x07");
  assert.equal(s.busy, true);
  const directory =
    process.platform === "win32"
      ? os.tmpdir().replaceAll("\\", "/")
      : os.tmpdir();
  state.track(s, `\x1b]7;file:///${directory.replace(/^\//, "")}\x1b\\`);
  assert.equal(path.normalize(s.cwd), path.normalize(os.tmpdir()));
});
test("a naturally exited PTY releases resources so its Node host can exit", async () => {
  const { execFile } = require("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-exit-"));
  const code = `
    const { Sessions } = require(${JSON.stringify(sessionsFile)});
    let sent = false;
    const keepAlive = setInterval(() => {}, 1000);
    const sessions = new Sessions({
      root: ${JSON.stringify(root)},
      assets: ${JSON.stringify(path.join(__dirname, "../assets"))},
      onOutput: ({ id, data }) => {
        sessions.ack(id, Buffer.byteLength(data));
        if (!sent) { sent = true; sessions.write(id, "exit\\r"); }
      },
      onExit: () => { clearInterval(keepAlive); process.stdout.write("SESSION_CLOSED\\n"); },
    });
    sessions.create({ shell: process.platform === "win32" ? "cmd" : "bash", cwd: ${JSON.stringify(root)} });
  `;
  try {
    const output = await new Promise((resolve, reject) => {
      execFile(process.execPath, ["-e", code], { encoding: "utf8", timeout: 15000 },
        (error, stdout) => error ? reject(new Error("PTY host did not exit: " + error.message + "\n" + stdout)) : resolve(stdout));
    });
    assert.ok(output.includes("SESSION_CLOSED"));
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
test(
  "Windows PowerShell integration preserves the original prompt function and last native exit status",
  { skip: process.platform !== "win32" },
  (t) => {
    const { execFileSync } = require("node:child_process");
    const { shellProfiles } = require("../src/shells.cjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-powershell-"));
    fs.writeFileSync(
      path.join(root, "settings.json"),
      JSON.stringify({ username_color: "#e783b2" }),
    );
    try {
      for (const profile of shellProfiles().filter(
        (s) => s.id === "powershell" || s.id === "pwsh",
      )) {
        t.diagnostic("Checking prompt with " + profile.id + " at " + profile.file);
        const script = path.join(root, "preserve.ps1");
        // Literal path is passed through the environment; no command interpolation.
        fs.writeFileSync(
          script,
          "[Console]::WriteLine('PROMPT_SCRIPT_STARTED')\nfunction global:prompt { 'CUSTOM_PROFILE_PROMPT' }\n. $env:TERMINAL_PROMPT_SCRIPT\n[Console]::WriteLine('PROMPT_SCRIPT_LOADED')\n$global:LASTEXITCODE = 37\nSet-PSDebug -Trace 1\n$result = prompt\nSet-PSDebug -Off\nif ($result -notlike '*CUSTOM_PROFILE_PROMPT*') { throw 'Custom prompt was discarded' }\nif ($global:LASTEXITCODE -ne 37) { throw 'Last exit status changed' }\n$result\n",
        );
        let output;
        try {
          output = execFileSync(
          profile.file,
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
          ],
          {
            encoding: "utf8",
            timeout: 15000,
            env: {
              ...process.env,
              MAC_STYLE_TERMINAL_SETTINGS: path.join(root, "settings.json"),
              TERMINAL_PROMPT_SCRIPT: path.join(
                __dirname,
                "../assets/prompt.ps1",
              ),
            },
          },
          );
        } catch (error) {
          t.diagnostic("PowerShell stdout: " + String(error.stdout || "").slice(-6000));
          t.diagnostic("PowerShell stderr: " + String(error.stderr || "").slice(-6000));
          throw error;
        }
        assert.ok(output.includes("CUSTOM_PROFILE_PROMPT"));
        assert.ok(output.includes("[38;2;231;131;178m"));
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
