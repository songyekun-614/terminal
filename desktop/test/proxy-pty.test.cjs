const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const fixture = require("../../tests/proxy-cases.json")[0];

test("a PTY launched without proxy variables passes the desktop proxy to shell children", { skip: process.platform !== "linux" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-proxy-"));
  try {
    // Only the external settings command is replaced; Sessions and Bash are real.
    fs.writeFileSync(path.join(root, "gsettings"), "#!/bin/sh\n/bin/cat <<'SETTINGS'\n" + fixture.settings + "SETTINGS\n", { mode: 0o755 });
    fs.writeFileSync(path.join(root, ".bashrc"), "");
    const env = { ...process.env, HOME: root, SHELL: "/bin/bash", PATH: root + path.delimiter + process.env.PATH };
    for (const name of ["http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
      delete env[name]; delete env[name.toUpperCase()];
    }
    const source = `
      const { Sessions } = require(${JSON.stringify(path.resolve(__dirname, "../src/sessions.cjs"))});
      let output = "", sent = false;
      const keepAlive = setInterval(() => {}, 1000);
      const sessions = new Sessions({
        root: process.env.HOME,
        assets: ${JSON.stringify(path.resolve(__dirname, "../assets"))},
        onOutput: ({ id, data }) => {
          output += data;
          sessions.ack(id, Buffer.byteLength(data));
          if (!sent && !sessions.info(id).busy) {
            sent = true;
            sessions.write(id, "printf 'CHILD_PROXY=%s\\\\n' \\\"$https_proxy\\\"; exit\\r");
          }
        },
        onExit: () => { clearInterval(keepAlive); process.stdout.write(output); },
      });
      sessions.create({ shell: "bash", cwd: process.env.HOME });
    `;
    const { stdout } = await execFile(process.execPath, ["-e", source], { env, timeout: 15000 });
    assert.ok(stdout.includes("CHILD_PROXY=http://127.0.0.1:8888"), stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
