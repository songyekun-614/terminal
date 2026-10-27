const { test, expect, _electron: electron } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
let app, page, root;
test("font choices preview, cancel and save while preserving custom font input", async () => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const choice = page.getByRole("combobox", { name: "可选字体", exact: true });
  const input = page.getByLabel("字体", { exact: true });
  await expect(choice).toBeVisible();
  const original = await input.inputValue();
  const options = await choice.locator("option").evaluateAll(nodes => nodes.map(n => n.value).filter(Boolean));
  const chosen = options.find(name => name !== original);
  expect(chosen).toBeTruthy();
  await choice.selectOption(chosen);
  await expect(input).toHaveValue(chosen);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(input).toHaveValue(original);
  await choice.selectOption(chosen);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8")).font_family).toBe(chosen);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(choice).toHaveValue(chosen);
  await input.fill("Custom Mono, monospace");
  await expect(choice).toHaveValue("");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8")).font_family).toBe("Custom Mono, monospace");
});
test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-ui-"));
  app = await electron.launch({
    executablePath: process.env.TERMINAL_TEST_EXECUTABLE,
    args: [
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      ...(process.env.TERMINAL_TEST_EXECUTABLE ? [] : [path.join(__dirname, "../src/main.cjs")]),
    ],
    env: { ...process.env, TERMINAL_CONFIG_ROOT: root },
  });
  page = await app.firstWindow();
  // Native confirmations are outside the renderer; act as a user choosing Close
  // unless a test explicitly exercises cancellation or a pending confirmation.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  try {
    await expect(page.getByRole("tab")).toHaveCount(1, { timeout: 15000 });
    await waitForIdleTerminal();
  } catch (error) {
    console.error("Terminal startup status:", await page.locator("#status").textContent());
    throw error;
  }
});
// Split panes must keep real PTYs, focus and layout independent within one tab.
test("split panes run independent shells and inherit the focused directory", async () => {
  const folder = path.join(root, "split-directory");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "directory-marker"), root);
  await page.keyboard.type(process.platform === "win32"
    ? `Set-Location -LiteralPath '${folder.replaceAll("'", "''")}'`
    : `cd '${folder.replaceAll("'", "'\\''")}'`);
  await page.keyboard.press("Enter");
  await waitForIdleTerminal();
  await page.getByRole("button", { name: "左右分屏", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await waitForIdleTerminal();
  const id = (await page.locator(".terminal-pane.active").getAttribute("id")).slice(9);
  const cwd = (await page.evaluate(id => window.terminalAPI.sessionInfo(id), id)).cwd;
  // Windows may report the same directory through its 8.3 alias or long path.
  // Reading the unique marker tests directory identity without spelling assumptions.
  expect(fs.readFileSync(path.join(cwd, "directory-marker"), "utf8")).toBe(root);
  await splitOutput("right");
  await expect(page.locator(".terminal-pane").first()).not.toContainText("split-right");
  await page.keyboard.press("Control+Shift+O");
  await expect(page.locator(".terminal-pane").first().locator("textarea")).toBeFocused();
  await splitOutput("left");
  await expect(page.locator(".terminal-pane").nth(1)).not.toContainText("split-left");
});

test("nested splits resize with pointer and keyboard and collapse on pane close", async () => {
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await waitForIdleTerminal();
  const separator = page.getByRole("separator").first();
  const first = page.locator(".terminal-pane").first();
  const before = await first.boundingBox();
  const handle = await separator.boundingBox();
  // Grab just outside the visible seam: narrow dividers must stay easy to drag.
  await page.mouse.move(handle.x + handle.width / 2 - 5, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 80, handle.y + handle.height / 2);
  await page.mouse.up();
  await expect.poll(async () => (await first.boundingBox()).width).toBeGreaterThan(before.width + 40);
  await separator.focus();
  await separator.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "15");
  await separator.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "85");
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "80");
  await separator.press("Home");
  await page.locator(".terminal-pane.active textarea").focus();
  await page.keyboard.press("Control+Shift+J");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(3);
  await expect(page.getByRole("separator")).toHaveCount(2);
  const panes = await page.locator(".terminal-pane").evaluateAll(elements => elements.map(e => {
    const b = e.getBoundingClientRect(); return { x:b.x, y:b.y, width:b.width, height:b.height };
  }));
  expect(Math.abs(panes[1].x - panes[2].x)).toBeLessThan(2);
  expect(panes[2].y).toBeGreaterThan(panes[1].y + panes[1].height);
  await waitForIdleTerminal();
  const closedId = (await page.locator(".terminal-pane.active").getAttribute("id")).slice(9);
  await page.keyboard.press("Control+Shift+X");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await expect(page.getByRole("separator")).toHaveCount(1);
  await expect(page.locator(".terminal-pane.active textarea")).toBeFocused();
  await expect.poll(() => page.evaluate(async id => {
    try { await window.terminalAPI.sessionInfo(id); return false; } catch { return true; }
  }, closedId)).toBe(true);
  await splitOutput("survivor");
});

test("tabs hide whole split layouts and restore the last focused pane", async () => {
  await page.getByRole("button", { name: "上下分屏", exact: true }).click();
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await waitForIdleTerminal();
  const focused = await page.locator(".terminal-pane.active").getAttribute("id");
  await page.keyboard.press("Control+Shift+T");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(1);
  await page.getByRole("tab").first().click();
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await expect(page.locator(".terminal-pane.active")).toHaveAttribute("id", focused);
  await page.getByRole("tab").first().dblclick();
  await page.getByLabel("标签名称").fill("分屏工作");
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await expect(page.getByRole("tab").first()).toHaveText("分屏工作");
  await page.keyboard.press("Control+Shift+X");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(1);
  await expect(page.getByRole("tab").first()).toHaveText("分屏工作");
});

test("closing an idle split tab always confirms and cancellation keeps every PTY", async () => {
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await waitForIdleTerminal();
  const ids = await page.locator(".terminal-pane").evaluateAll(es => es.map(e => e.id.slice(9)));
  await app.evaluate(({ dialog }) => {
    global.idleCloseCalls = 0;
    dialog.showMessageBox = async () => { global.idleCloseCalls++; return { response: 0 }; };
  });
  await page.getByRole("button", { name: "关闭标签页", exact: true }).click();
  await expect.poll(() => app.evaluate(() => global.idleCloseCalls)).toBe(1);
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await page.keyboard.press("Control+Shift+W");
  await expect.poll(() => app.evaluate(() => global.idleCloseCalls)).toBe(2);
  for (const id of ids) expect(await page.evaluate(id => window.terminalAPI.sessionInfo(id), id)).toHaveProperty("cwd");
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.keyboard.press("Control+Shift+W");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(1);
  for (const id of ids) await expect.poll(() => page.evaluate(async id => {
    try { await window.terminalAPI.sessionInfo(id); return false; } catch { return true; }
  }, id)).toBe(true);
});

test("closing a split tab checks busy background panes once and releases every PTY", async () => {
  await page.keyboard.type(process.platform === "win32" ? "Start-Sleep -Seconds 60" : "sleep 60");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "左右分屏", exact: true }).click();
  await waitForIdleTerminal();
  const ids = await page.locator(".terminal-pane").evaluateAll(es => es.map(e => e.id.slice(9)));
  await app.evaluate(({ dialog }) => {
    global.splitCloseCalls = 0;
    dialog.showMessageBox = async () => { global.splitCloseCalls++; return { response: 0 }; };
  });
  await page.getByRole("button", { name: "关闭标签页", exact: true }).click();
  await expect.poll(() => app.evaluate(() => global.splitCloseCalls)).toBe(1);
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.keyboard.press("Control+Shift+W");
  await expect(page.locator(".terminal-pane")).toHaveCount(1);
  for (const id of ids) await expect.poll(() => page.evaluate(async id => {
    try { await window.terminalAPI.sessionInfo(id); return false; } catch { return true; }
  }, id)).toBe(true);
});

async function splitOutput(suffix) {
  await page.keyboard.type(process.platform === "win32"
    ? `Write-Output ('split-' + '${suffix}')`
    : `printf '%s\\n' 'split-'${suffix}`);
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-pane.active .xterm-screen")).toContainText(`split-${suffix}`);
}

test("overflowing tabs stay outside the split toolbar", async () => {
  for (let i = 2; i <= 15; i++) {
    await page.getByRole("button", { name: "新建标签页", exact: true }).click();
    await expect(page.getByRole("tab")).toHaveCount(i);
  }
  const boxes = await page.evaluate(() => {
    const tabs = document.getElementById("tabs");
    tabs.scrollLeft = 0;
    const list = tabs.getBoundingClientRect();
    const tools = document.getElementById("pane-tools").getBoundingClientRect();
    return { tabsRight: list.right, toolsLeft: tools.left };
  });
  expect(boxes.tabsRight).toBeLessThanOrEqual(boxes.toolsLeft);
  await page.getByRole("button", { name: "左右分屏", exact: true }).click();
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
});

test("closing while a split session is being created cannot orphan its PTY", async () => {
  await app.evaluate(({ app }) => {
    const load = process.getBuiltinModule("module").createRequire(app.getAppPath() + "/package.json");
    const { Sessions } = load(app.isPackaged ? "./src/sessions.cjs" : "./sessions.cjs");
    const create = Sessions.prototype.create;
    Sessions.prototype.create = function (options) {
      const result = create.call(this, options);
      global.pendingSplitId = result.id;
      return new Promise(resolve => { global.finishSplitCreation = () => {
        Sessions.prototype.create = create;
        resolve(result);
      }; });
    };
  });
  await page.getByRole("button", { name: "左右分屏", exact: true }).click();
  await expect.poll(() => app.evaluate(() => Boolean(global.pendingSplitId))).toBe(true);
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(1);
  await app.evaluate(() => global.finishSplitCreation());
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await expect(page.locator(".terminal-pane.active textarea")).toBeFocused();
});

test("clicking a background pane heading moves both typing and paste focus", async () => {
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await waitForIdleTerminal();
  await page.locator(".terminal-pane").first().locator(".pane-heading span").click();
  await expect(page.locator(".terminal-pane").first().locator("textarea")).toBeFocused();
  await splitOutput("heading");
  await expect(page.locator(".terminal-pane").nth(1)).not.toContainText("split-heading");
});

test("overlapping tab closes preserve a usable terminal while a close is pending", async () => {
  await page.keyboard.press("Control+Shift+T");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await waitForIdleTerminal();
  await app.evaluate(({ app }) => {
    const load = process.getBuiltinModule("module").createRequire(app.getAppPath() + "/package.json");
    const { Sessions } = load(app.isPackaged ? "./src/sessions.cjs" : "./sessions.cjs");
    const close = Sessions.prototype.close;
    global.pendingTabCloses = [];
    Sessions.prototype.close = function (id) {
      close.call(this, id);
      return new Promise(resolve => global.pendingTabCloses.push(resolve));
    };
    global.finishTabClose = () => {
      Sessions.prototype.close = close;
      for (const resolve of global.pendingTabCloses) resolve();
    };
  });
  await page.keyboard.press("Control+Shift+W");
  await expect.poll(() => app.evaluate(() => global.pendingTabCloses.length)).toBe(1);
  await page.getByRole("tab").first().click();
  await page.keyboard.press("Control+Shift+W");
  expect(await app.evaluate(() => global.pendingTabCloses.length)).toBe(1);
  await app.evaluate(() => global.finishTabClose());
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".terminal-pane.active textarea")).toBeFocused();
  await splitOutput("remaining");
});

test("switching tabs during a pane close preserves the surviving pane selection", async () => {
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await waitForIdleTerminal();
  await page.keyboard.press("Control+Shift+T");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").first().click();
  await app.evaluate(({ app }) => {
    const load = process.getBuiltinModule("module").createRequire(app.getAppPath() + "/package.json");
    const { Sessions } = load(app.isPackaged ? "./src/sessions.cjs" : "./sessions.cjs");
    const close = Sessions.prototype.close;
    Sessions.prototype.close = function (id) {
      close.call(this, id);
      global.pendingPaneClose = true;
      return new Promise(resolve => { global.finishPaneClose = () => {
        Sessions.prototype.close = close;
        resolve();
      }; });
    };
  });
  await page.keyboard.press("Control+Shift+X");
  await expect.poll(() => app.evaluate(() => Boolean(global.pendingPaneClose))).toBe(true);
  await page.getByRole("tab").nth(1).click();
  const other = await page.locator(".terminal-pane.active").getAttribute("id");
  await app.evaluate(() => global.finishPaneClose());
  await expect(page.locator(".terminal-pane")).toHaveCount(2);
  await expect(page.locator(".terminal-pane.active")).toHaveAttribute("id", other);
  await page.getByRole("tab").first().click();
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".terminal-pane.active textarea")).toBeFocused();
});

test("a delayed clipboard paste stays in its split pane after focus changes", async () => {
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await waitForIdleTerminal();
  const origin = await page.locator(".terminal-pane.active").getAttribute("id");
  await app.evaluate(({ clipboard }, command) => {
    clipboard.writeText(command);
    const read = clipboard.readText.bind(clipboard);
    clipboard.readText = () => new Promise(resolve => setTimeout(() => resolve(read()), 700));
  }, process.platform === "win32" ? "Write-Output ('pane-' + 'clipboard')" : "printf '%s\\n' 'pane-'clipboard");
  await page.keyboard.press("Control+V");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+Shift+O");
  await expect(page.locator(`#${origin} .xterm-screen`)).toContainText("pane-clipboard");
  await expect(page.locator(".terminal-pane.active .xterm-screen")).not.toContainText("pane-clipboard");
  await expect(page.locator(".terminal-pane.active textarea")).toBeFocused();
});

test("resizing a split updates the real PTY dimensions of an unfocused pane", async () => {
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await waitForIdleTerminal();
  await page.keyboard.press("Control+Shift+O");
  const pane = page.locator(".terminal-pane.active");
  const id = await pane.getAttribute("id");
  const sizeCommand = marker => process.platform === "win32"
    ? `[Console]::WriteLine(('${marker}-size:' + [Console]::WindowHeight + ' ' + [Console]::WindowWidth))`
    : `printf '${marker}-size:%s\\n' "$(stty size)"`;
  await page.keyboard.type(sizeCommand("before"));
  await page.keyboard.press("Enter");
  const screen = page.locator(`#${id} .xterm-screen`);
  await expect(screen).toContainText(/before-size:\d+ \d+/);
  const before = (await screen.textContent()).match(/before-size:(\d+) (\d+)/);
  await waitForIdleTerminal();
  await page.keyboard.press("Control+Shift+O");
  await page.getByRole("separator").focus();
  await page.getByRole("separator").press("Home");
  await page.locator(`#${id} textarea`).focus();
  // Wait on the actual terminal viewport, rather than a timer, before querying the PTY.
  await expect.poll(async () => (await page.locator(`#${id}`).boundingBox()).width).toBeLessThan(250);
  await page.keyboard.type(sizeCommand("after"));
  await page.keyboard.press("Enter");
  await expect(screen).toContainText(/after-size:\d+ \d+/);
  const after = (await screen.textContent()).match(/after-size:(\d+) (\d+)/);
  expect(Number(after[2])).toBeLessThan(Number(before[2]));
});
test.afterEach(async () => {
  if (app) {
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});
    await app.close();
  }
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("Ctrl+V pastes clipboard text once into the real shell", async () => {
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await app.evaluate(({ clipboard }, command) => clipboard.writeText(command),
    process.platform === "win32"
      ? "Write-Output ('clipboard-' + '你好')"
      : "printf '%s\\n' 'clipboard-'你好");
  await page.keyboard.press("Control+V");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-pane.active .xterm-screen"))
    .toContainText("clipboard-你好");
  expect((await page.locator(".terminal-pane.active .xterm-screen").textContent())
    .match(/clipboard-你好/g)).toHaveLength(1);
});

test("Enter waits for a delayed clipboard read before reaching the shell", async () => {
  await app.evaluate(({ clipboard }, command) => {
    clipboard.writeText(command);
    const readText = clipboard.readText.bind(clipboard);
    clipboard.readText = () => new Promise((resolve) =>
      setTimeout(() => resolve(readText()), 300));
  }, process.platform === "win32"
    ? "Write-Output ('ordered-' + 'clipboard')"
    : "printf '%s\\n' 'ordered-'clipboard");
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.press("Control+V");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-pane.active .xterm-screen"))
    .toContainText("ordered-clipboard");
});

test("typing after a delayed paste preserves the user's input order", async () => {
  await app.evaluate(({ clipboard }, command) => {
    clipboard.writeText(command);
    const readText = clipboard.readText.bind(clipboard);
    clipboard.readText = () => new Promise((resolve) =>
      setTimeout(() => resolve(readText()), 300));
  }, process.platform === "win32"
    ? "Write-Output ('typed-' + '"
    : "printf '%s\\n' 'typed-'");
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Shift+V");
  await page.keyboard.type(process.platform === "win32" ? "suffix')" : "suffix");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-pane.active .xterm-screen"))
    .toContainText("typed-suffix");
});

test("a delayed paste stays in its original tab without taking focus back", async () => {
  await app.evaluate(({ clipboard }, command) => {
    clipboard.writeText(command);
    const readText = clipboard.readText.bind(clipboard);
    clipboard.readText = () => new Promise((resolve) =>
      setTimeout(() => resolve(readText()), 700));
  }, process.platform === "win32"
    ? "Write-Output ('original-' + 'tab')"
    : "printf '%s\\n' 'original-'tab");
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.press("Control+V");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "新建标签页", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".terminal-pane").first().locator(".xterm-screen"))
    .toContainText("original-tab");
  await expect(page.locator(".terminal-pane.active .xterm-screen"))
    .not.toContainText("original-tab");
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
});

test("menu paste returns focus so Enter executes the pasted command", async () => {
  await expect(page.getByRole("tab")).toHaveCount(1);
  await app.evaluate(({ clipboard }, command) => clipboard.writeText(command),
    process.platform === "win32"
      ? "Write-Output ('menu-' + 'clipboard')"
      : "printf '%s\\n' 'menu-'clipboard");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "粘贴", exact: true }).click();
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-pane.active .xterm-screen"))
    .toContainText("menu-clipboard");
});

test("copy without a terminal selection preserves the clipboard", async () => {
  await expect(page.getByRole("tab")).toHaveCount(1);
  await app.evaluate(({ clipboard }) => clipboard.writeText("keep-你好"));
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Shift+C");
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe("keep-你好");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe("keep-你好");
});

test("Ctrl+C copies terminal selection and still interrupts without selection", async () => {
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.type(process.platform === "win32"
    ? "Write-Output 'selected-clipboard'" : "printf 'selected-clipboard\\n'");
  await page.keyboard.press("Enter");
  await expect.poll(async () =>
    (await page.locator(".terminal-pane.active .xterm-screen").textContent())
      .match(/selected-clipboard/g)?.length || 0).toBe(2);
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.keyboard.press("Control+C");
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain("selected-clipboard");
  await app.evaluate(({ clipboard }) => clipboard.writeText("reset"));
  await page.keyboard.press("Control+Shift+C");
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain("selected-clipboard");
  await app.evaluate(({ clipboard }) => clipboard.writeText("reset"));
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain("selected-clipboard");
  // Pasting clears the terminal selection; the next Ctrl+C must reach the shell.
  await app.evaluate(({ clipboard }, command) => clipboard.writeText(command),
    process.platform === "win32"
      ? "Write-Output 'SLEEP_STARTED'; Start-Sleep -Seconds 30"
      : "printf 'SLEEP_STARTED\\n'; sleep 30");
  await page.keyboard.press("Control+Shift+V");
  await page.keyboard.press("Enter");
  await expect.poll(async () =>
    (await page.locator(".terminal-pane.active .xterm-screen").textContent())
      .match(/SLEEP_STARTED/g)?.length || 0).toBe(2);
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(async () => {
    const id = document.querySelector(".terminal-pane.active").id.slice("terminal-".length);
    return (await window.terminalAPI.sessionInfo(id)).busy;
  })).toBe(false);
  await page.keyboard.type(process.platform === "win32"
    ? "Write-Output ('interrupt-' + 'works')" : "printf '%s\\n' 'interrupt-'works");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-pane.active .xterm-screen"))
    .toContainText("interrupt-works");
});

test("clipboard shortcuts in editable fields do not paste into the terminal", async () => {
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await app.evaluate(({ clipboard }) => clipboard.writeText("search-clipboard"));
  await page.getByLabel("搜索内容").press("Control+V");
  await expect(page.getByLabel("搜索内容")).toHaveValue("search-clipboard");
  await page.getByLabel("搜索内容").press("Control+A");
  await app.evaluate(({ clipboard }) => clipboard.writeText("reset"));
  await page.getByLabel("搜索内容").press("Control+C");
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe("search-clipboard");
  await expect(page.locator(".terminal-pane.active .xterm-screen"))
    .not.toContainText("search-clipboard");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await app.evaluate(({ clipboard }) => clipboard.writeText("#abcdef"));
  await page.getByLabel("背景颜色", { exact: true }).press("Control+A");
  await page.getByLabel("背景颜色", { exact: true }).press("Control+V");
  await expect(page.getByLabel("背景颜色", { exact: true })).toHaveValue("#abcdef");
});

test("real PTY Unicode, tabs, settings, search and busy close", async () => {
  await expect(page.locator("header .heading strong")).toHaveText("terminal");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await app.evaluate(
    ({ clipboard }, command) => clipboard.writeText(command),
    process.platform === "win32"
      ? "Write-Output 'renderer-你好'"
      : "printf 'renderer-你好\\n'",
  );
  await page.keyboard.press("Control+Shift+V");
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (
          (
            await page
              .locator(".terminal-pane.active .xterm-screen")
              .textContent()
          ).match(/renderer-你好/g) || []
        ).length,
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "新建标签页", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").nth(1).dblclick();
  await page.getByLabel("标签名称").fill("工作");
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await expect(page.getByRole("tab").nth(1)).toHaveText("工作");
  await page.getByRole("tab").first().click();
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.type(
    process.platform === "win32"
      ? "Write-Output 'input-preserved'"
      : "printf 'input-preserved\\n'",
  );
  for (let i = 0; i < (process.platform === "win32" ? 1 : 3); i++)
    await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("背景颜色", { exact: true }).fill("#123456");
  await page.getByLabel("字体大小", { exact: true }).fill("16");
  await page.getByLabel("用户名与主机颜色", { exact: true }).fill("#e783b2");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("--terminal-bg", "#123456");
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.type("-cursor");
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (
          (
            await page
              .locator(".terminal-pane.active .xterm-screen")
              .textContent()
          ).match(/input-preserved-cursor/g) || []
        ).length,
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByLabel("搜索内容").fill("renderer-你好");
  await page.getByLabel("搜索内容").press("Enter");
  await expect(page.getByRole("status")).toContainText("找到");
  await page.getByRole("button", { name: "关闭搜索" }).click();
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.type(
    process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30",
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await app.evaluate(({ dialog }) => {
    global.closeDialogCalls = 0;
    dialog.showMessageBox = async () => {
      global.closeDialogCalls++;
      return { response: 0 };
    };
  });
  await page.getByRole("button", { name: "关闭标签页" }).first().click();
  await expect.poll(() => app.evaluate(() => global.closeDialogCalls)).toBe(1);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.getByRole("button", { name: "关闭标签页" }).first().click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.waitForTimeout(200); // Complete the documented 180ms tab fade before visual inspection.
  await page.screenshot({
    path: path.join(__dirname, `../../docs/desktop-${process.platform}.png`),
  });
});

test("wallpaper cancel and remove clean only imported copies", async () => {
  const source = path.join(__dirname, "../assets/icon.png");
  const originalImage = fs.readFileSync(source);
  const files = () =>
    fs.existsSync(path.join(root, "wallpapers"))
      ? fs
          .readdirSync(path.join(root, "wallpapers"), { recursive: true })
          .filter((name) =>
            fs.statSync(path.join(root, "wallpapers", name)).isFile(),
          )
      : [];
  await expect(page.getByRole("tab")).toHaveCount(1);
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
  }, source);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "导入壁纸", exact: true }).click();
  await expect.poll(() => files().length).toBe(1);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect.poll(() => files().length).toBe(0);
  expect(fs.readFileSync(source)).toEqual(originalImage);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "导入壁纸", exact: true }).click();
  await expect.poll(() => files().length).toBe(1);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "移除壁纸", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => files().length).toBe(0);
  expect(fs.readFileSync(source)).toEqual(originalImage);
});

test("idle wrapped prompt recolors while preserving input and cursor", async () => {
  test.skip(
    process.platform === "win32",
    "Bash prompt wrapping test; Windows runs the PowerShell integration test above.",
  );
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  const setup = "PS1=\"$(printf '%*s' \"$((COLUMNS-3))\" '')\\u@\\h $ \"";
  await app.evaluate(
    ({ clipboard }, command) => clipboard.writeText(command),
    setup,
  );
  await page.keyboard.press("Control+Shift+V");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await page.keyboard.type("printf 'wrap-preserved\\n'");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("用户名与主机颜色", { exact: true }).fill("#e783b2");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".terminal-pane.active .xterm-screen span")
        .evaluateAll((elements) =>
          elements
            .filter(
              (element) =>
                getComputedStyle(element).color === "rgb(231, 131, 178)",
            )
            .map((element) => element.textContent)
            .join(""),
        ),
    )
    .toContain(`${os.userInfo().username}@${os.hostname().split(".")[0]}`);
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.type("-cursor");
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (
          (
            await page
              .locator(".terminal-pane.active .xterm-screen")
              .textContent()
          ).match(/wrap-preserved-cursor/g) || []
        ).length,
    )
    .toBeGreaterThanOrEqual(2);
});

test("renderer isolation and reload dispose prior PTYs", async () => {
  await expect(page.getByRole("tab")).toHaveCount(1);
  expect(await page.evaluate(() => typeof require)).toBe("undefined");
  const old = await page.evaluate(() =>
    window.terminalAPI.createSession({ cols: 80, rows: 24 }),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.reload(),
  );
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        try {
          await window.terminalAPI.sessionInfo(id);
          return false;
        } catch {
          return true;
        }
      }, old.id),
    )
    .toBe(true);
  if (process.platform !== "win32")
    await expect
      .poll(() => {
        try {
          process.kill(old.pid, 0);
          return false;
        } catch (error) {
          return error.code === "ESRCH";
        }
      })
      .toBe(true)
      .catch((error) => {
        // Preserve evidence before afterEach closes Electron and reaps children.
        for (const file of ["stat", "cmdline", "wchan"]) {
          try {
            console.error(`Reload PTY ${old.pid} ${file}:`,
              fs.readFileSync(`/proc/${old.pid}/${file}`, "utf8"));
          } catch (readError) {
            console.error(`Reload PTY ${old.pid} ${file}:`, readError.code);
          }
        }
        throw error;
      });
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.type(
    process.platform === "win32"
      ? "Write-Output 'reload-ok'"
      : "printf 'reload-ok\\n'",
  );
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (
          (
            await page
              .locator(".terminal-pane.active .xterm-screen")
              .textContent()
          ).match(/reload-ok/g) || []
        ).length,
    )
    .toBeGreaterThanOrEqual(2);
});

test('zoom reset restores the saved font size', async () => {
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByLabel('字体大小',{exact:true}).fill('18');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  const font = page.locator('.terminal-pane.active .xterm-rows');
  await page.keyboard.press('Control+-');
  await expect(font).toHaveCSS('font-size','17px');
  await page.keyboard.press('Control+0');
  await expect(font).toHaveCSS('font-size','18px');
});

async function waitForIdleTerminal() {
  await expect.poll(() => page.evaluate(async () => {
    const pane = document.querySelector(".terminal-pane.active");
    return pane && !(await window.terminalAPI.sessionInfo(pane.id.slice(9))).busy;
  }), { timeout: 15000 }).toBe(true);
}

test("Escape keeps idle and busy split panes alive without close confirmation", async () => {
  await page.keyboard.press("Control+Shift+T");
  await waitForIdleTerminal();
  await page.keyboard.press("Control+Shift+H");
  await waitForIdleTerminal();
  const panes = await page.locator(".terminal-pane").evaluateAll(nodes => nodes.map(node => node.id));
  await app.evaluate(({ dialog }) => {
    global.escapeCloseCalls = 0;
    dialog.showMessageBox = async () => { global.escapeCloseCalls++; return { response: 1 }; };
  });
  // Cover shell prompts as well as a foreground CLI that owns its input.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+C");
  await waitForIdleTerminal();
  await page.keyboard.type(process.platform === "win32" ? "Start-Sleep -Seconds 120" : "sleep 120");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(async () =>
    (await window.terminalAPI.sessionInfo(document.querySelector(".terminal-pane.active").id.slice(9))).busy)).toBe(true);
  await page.keyboard.down("Escape");
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  // IPC round-trip observes the main process after the keyboard handlers ran.
  expect(await app.evaluate(() => global.escapeCloseCalls)).toBe(0);
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(await page.locator(".terminal-pane").evaluateAll(nodes => nodes.map(node => node.id))).toEqual(panes);
  // The shared afterEach closes the app and owns cleanup of this busy PTY.
});

test("a custom close-or-exit shortcut closes only the active tab and restores focus", async () => {
  await configureCloseShortcut();
  await page.getByRole("button", { name: "新建标签页", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await waitForIdleTerminal();
  const activePane = await page.locator(".terminal-pane.active").getAttribute("id");
  await page.keyboard.press("F6");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(`[id="${activePane}"]`)).toHaveCount(0);
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
});

test("a custom close-or-exit shortcut on the final idle tab honors cancellation", async () => {
  await configureCloseShortcut();
  await waitForIdleTerminal();
  await app.evaluate(({ dialog }) => {
    global.finalIdleCloseCalls = 0;
    dialog.showMessageBox = async () => { global.finalIdleCloseCalls++; return { response: 0 }; };
  });
  await page.keyboard.press("F6");
  await expect.poll(() => app.evaluate(() => global.finalIdleCloseCalls)).toBe(1);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  const closed = page.waitForEvent("close");
  await page.keyboard.press("F6").catch(error => {
    if (!page.isClosed()) throw error;
  });
  await closed;
  expect(page.isClosed()).toBe(true);
});

test("Escape cancels settings before dismissing search without closing a tab", async () => {
  await page.locator("#search-open").click();
  await page.locator("#settings-open").click();
  const before = await page.locator("body").evaluate(el => el.style.getPropertyValue("--terminal-bg"));
  await page.locator('[name="background"]').fill("#abcdef");
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings")).not.toBeVisible();
  await expect(page.locator("#search")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect.poll(() => page.locator("body").evaluate(el => el.style.getPropertyValue("--terminal-bg"))).toBe(before);
  await page.keyboard.press("Escape");
  await expect(page.locator("#search")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
});

test("Escape cancels a reopened settings dialog after an earlier save", async () => {
  await page.locator("#settings-open").click();
  await page.locator('[name="background"]').fill("#223344");
  await page.locator('#settings-form button[type="submit"]').click();
  await expect(page.locator("#settings")).not.toBeVisible();
  await page.locator("#settings-open").click();
  await page.locator('[name="background"]').fill("#abcdef");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.locator("body").evaluate(el => el.style.getPropertyValue("--terminal-bg"))).toBe("#223344");
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("IBus Shift toggles Chinese after submitting a tab rename", async () => {
  test.skip(process.platform !== "linux" || process.env.TERMINAL_TEST_IBUS !== "1",
    "Requires an X11 desktop with IBus libpinyin, Shift switching, and xdotool");
  const { execFileSync } = require("node:child_process");
  const x = (...args) => execFileSync("xdotool", args, { encoding: "utf8" }).trim();
  expect(execFileSync("ibus", ["engine"], { encoding: "utf8" }).trim()).toBe("libpinyin");
  const handle = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
  x("windowactivate", "--sync", String(handle));
  await page.evaluate(() => {
    window.imeCommits = [];
    document.addEventListener("compositionend", event => {
      if (event.target.matches(".xterm-helper-textarea")) window.imeCommits.push(event.data);
    });
  });
  async function togglePair() {
    const modes = [];
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { window.imeCommits = []; });
      x("key", "Shift_L");
      x("type", "--delay", "80", "ni");
      x("key", "space");
      // Allow native IBus/Chromium composition messages to reach the renderer.
      await page.waitForTimeout(150);
      const commits = await page.evaluate(() => window.imeCommits);
      modes.push(commits.some(text => /\p{Script=Han}/u.test(text)) ? "chinese" : "english");
      x("key", "ctrl+u");
    }
    return modes.sort();
  }
  expect(await togglePair()).toEqual(["chinese", "english"]);
  for (const submit of ["enter", "click"]) {
    await page.getByRole("tab").dblclick();
    await page.locator("#tab-name").fill(`IME ${submit}`);
    // Playwright's keyboard injection bypasses the native IBus path.
    if (submit === "enter") x("key", "Return");
    else await page.locator('#rename button[value="save"]').click();
    await expect(page.locator("#rename")).not.toBeVisible();
    await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
    expect(await togglePair()).toEqual(["chinese", "english"]);
  }
});

test("Enter saves the tab name and Cancel discards edits", async () => {
  await page.keyboard.press("Control+Shift+R");
  await page.locator("#tab-name").fill("中文 terminal");
  await page.keyboard.press("Enter");
  await expect(page.locator("#rename")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveText("中文 terminal");
  await page.keyboard.press("Control+Shift+R");
  await page.locator("#tab-name").fill("discarded title");
  await page.locator('#rename button[value="cancel"]').click();
  await expect(page.locator("#rename")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveText("中文 terminal");
});

test("Escape cancels a reopened rename dialog without applying its input", async () => {
  await page.keyboard.press("Control+Shift+R");
  await page.locator("#tab-name").fill("kept title");
  await page.locator('#rename button[value="save"]').click();
  await expect(page.getByRole("tab")).toHaveText("kept title");
  await page.keyboard.press("Control+Shift+R");
  await page.locator("#tab-name").fill("discarded title");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab")).toHaveText("kept title");
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
});

test("Escape dismisses menu and about without closing the tab", async () => {
  await page.locator("#menu-open").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#menu")).not.toBeVisible();
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
  await page.locator("#menu-open").click();
  await page.getByRole("button", { name: "关于终端", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#about")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
});

test("holding a custom close-or-exit shortcut does not close another tab", async () => {
  await configureCloseShortcut();
  await page.getByRole("button", { name: "新建标签页", exact: true }).click();
  await waitForIdleTerminal();
  await page.keyboard.down("F6");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.keyboard.down("F6");
  await page.keyboard.up("F6");
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("a custom close-or-exit shortcut on the last busy tab honors confirmation", async () => {
  await configureCloseShortcut();
  await waitForIdleTerminal();
  await page.keyboard.type(process.platform === "win32" ? "Start-Sleep -Seconds 120" : "sleep 120");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(async () => (await window.terminalAPI.sessionInfo(document.querySelector(".terminal-pane.active").id.slice(9))).busy)).toBe(true);
  await app.evaluate(({ dialog }) => {
    global.escapeConfirmations = 0;
    dialog.showMessageBox = async () => {
      global.escapeConfirmations++;
      return { response: 0 };
    };
  });
  await page.keyboard.press("F6");
  await expect.poll(() => app.evaluate(() => global.escapeConfirmations)).toBe(1);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  const closed = page.waitForEvent("close");
  await page.keyboard.press("F6").catch(error => {
    if (!page.isClosed()) throw error;
  });
  await closed;
  expect(page.isClosed()).toBe(true);
});

test("a pending custom close confirmation cannot close another tab", async () => {
  await configureCloseShortcut();
  await page.getByRole("button", { name: "新建标签页", exact: true }).click();
  await waitForIdleTerminal();
  await page.keyboard.type(process.platform === "win32" ? "Start-Sleep -Seconds 120" : "sleep 120");
  await page.keyboard.press("Enter");
  await app.evaluate(({ dialog }) => {
    global.escapeConfirmations = 0;
    dialog.showMessageBox = () => {
      global.escapeConfirmations++;
      return new Promise(resolve => { global.resolveEscapeConfirmation = resolve; });
    };
  });
  await page.keyboard.press("F6");
  await expect.poll(() => app.evaluate(() => global.escapeConfirmations)).toBe(1);
  await page.keyboard.press("F6");
  expect(await app.evaluate(() => global.escapeConfirmations)).toBe(1);
  await app.evaluate(() => global.resolveEscapeConfirmation({ response: 1 }));
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
});

async function openShortcuts() {
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "快捷键设置…", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "快捷键设置", exact: true })).toBeVisible();
}
async function recordShortcut(label, chord) {
  await page.getByRole("button", { name: `${label}快捷键`, exact: true }).click();
  await page.keyboard.press(chord);
}
async function configureCloseShortcut() {
  await openShortcuts();
  await recordShortcut("关闭面板或退出", "F6");
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect(page.locator("#shortcuts")).not.toBeVisible();
}


test("custom shortcuts replace old bindings, persist on reload and update toolbar hints", async () => {
  await openShortcuts();
  await recordShortcut("新建标签页", "Control+Alt+N");
  await recordShortcut("左右分屏", "Control+Alt+H");
  await recordShortcut("关闭当前面板", "Control+Alt+X");
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect(page.locator("#shortcuts")).not.toBeVisible();
  expect(JSON.parse(fs.readFileSync(path.join(root, "settings.json"))).shortcuts.new_tab).toBe("Ctrl+Alt+N");
  await expect(page.locator("#split-horizontal")).toHaveAttribute("aria-keyshortcuts", "Control+Alt+H");
  await expect(page.getByRole("button", { name: "关闭此面板", exact: true, includeHidden: true })).toHaveAttribute("title", "关闭此面板 · Ctrl+Alt+X");
  await page.keyboard.press("Control+Alt+N");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await waitForIdleTerminal();
  await page.keyboard.press("Control+Shift+T");
  await page.keyboard.press("Control+Alt+H");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await expect(page.locator(".terminal-pane:visible button[aria-label=关闭此面板]").last()).toHaveAttribute("aria-keyshortcuts", "Control+Alt+X");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await waitForIdleTerminal();
  await page.keyboard.press("Control+Alt+N");
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("shortcut recording reports conflicts, supports clearing and cancelling without saving", async () => {
  await openShortcuts();
  await recordShortcut("新建标签页", "Control+Shift+W");
  await expect(page.locator("#shortcuts-error")).toContainText("冲突");
  await expect(page.getByRole("button", { name: "保存快捷键", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "新建标签页快捷键", exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "清除关闭标签页快捷键", exact: true }).click();
  await expect(page.locator("#shortcuts-error")).toBeEmpty();
  await expect(page.getByRole("button", { name: "保存快捷键", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.keyboard.press("Control+Shift+T");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await openShortcuts();
  await expect(page.getByRole("button", { name: "新建标签页快捷键", exact: true })).toHaveText("Ctrl+Shift+T");
  await page.getByRole("button", { name: "新建标签页快捷键", exact: true }).click();
  await page.keyboard.press("Control+V");
  await expect(page.locator("#shortcuts-error")).toContainText("保留");
  await page.keyboard.press("Escape");
  await expect(page.locator("#shortcuts")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#shortcuts")).not.toBeVisible();
});

test("legacy Escape bindings migrate on startup without losing custom shortcuts", async () => {
  const file = path.join(root, "settings.json");
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));
  settings.shortcuts = { ...settings.shortcuts, escape_close: "Escape", new_tab: "Alt+Shift+N" };
  fs.writeFileSync(file, JSON.stringify(settings));
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await waitForIdleTerminal();
  const loaded = await page.evaluate(async () => (await window.terminalAPI.bootstrap()).settings.shortcuts);
  expect(loaded.escape_close).toBe("");
  await page.keyboard.press("Alt+Shift+N");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await waitForIdleTerminal();
  await openShortcuts();
  await expect(page.getByRole("button", { name: "关闭面板或退出快捷键", exact: true })).toHaveText("未设置");
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect(page.locator("#shortcuts")).not.toBeVisible();
  expect(JSON.parse(fs.readFileSync(file, "utf8")).shortcuts.escape_close).toBe("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("default Escape reaches the real PTY while dialog Escape still cancels", async () => {
  await app.evaluate(({ ipcMain }) => {
    global.escapeWrites = [];
    const handlers = ipcMain._invokeHandlers;
    const original = handlers.get("terminal:write");
    ipcMain.removeHandler("terminal:write");
    ipcMain.handle("terminal:write", (event, id, data) => {
      global.escapeWrites.push(data);
      return original(event, id, data);
    });
  });
  await page.keyboard.press("Escape");
  await expect.poll(() => app.evaluate(() => global.escapeWrites.join(""))).toContain("\x1b");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await openShortcuts();
  await page.keyboard.press("Escape");
  await expect(page.locator("#shortcuts")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("shortcut saves do not commit or discard an open appearance preview", async () => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("字体大小", { exact: true }).fill("19");
  await page.locator("#shortcuts-open").click();
  await recordShortcut("新建标签页", "Control+Alt+N");
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect(page.locator("#shortcuts")).not.toBeVisible();
  await expect(page.locator("#settings")).toBeVisible();
  const disk = JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8"));
  expect(disk.font_size).toBe(12);
  expect(disk.shortcuts.new_tab).toBe("Ctrl+Alt+N");
  await page.locator("#settings-cancel").click();
  await expect(page.locator(".terminal-pane.active .xterm-rows")).toHaveCSS("font-size", "12px");
  await page.keyboard.press("Control+Alt+N");
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("custom paste executes once, and recording navigation and reset stay keyboard accessible", async () => {
  await openShortcuts();
  await recordShortcut("粘贴", "Control+Alt+V");
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect(page.locator("#shortcuts")).not.toBeVisible();
  await app.evaluate(({ clipboard }, command) => clipboard.writeText(command),
    process.platform === "win32" ? "Write-Output ('custom-' + 'paste')" : "printf '%s\\n' 'custom-'paste");
  await page.keyboard.press("Control+Alt+V");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-pane.active .xterm-screen")).toContainText("custom-paste");
  expect((await page.locator(".terminal-pane.active .xterm-screen").textContent()).match(/custom-paste/g)).toHaveLength(1);
  await openShortcuts();
  const recorder = page.getByRole("button", { name: "新建标签页快捷键", exact: true });
  await recorder.click();
  await page.keyboard.press("Tab");
  await expect(recorder).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "清除新建标签页快捷键", exact: true })).toBeFocused();
  await recordShortcut("新建标签页", "Control+Tab");
  await expect(recorder).toHaveText("Ctrl+Tab");
  await expect(recorder).toHaveAccessibleDescription(/当前快捷键：Ctrl\+Tab/);
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(page.getByRole("button", { name: "粘贴快捷键", exact: true })).toHaveText("Ctrl+Shift+V");
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect(page.locator("#shortcuts")).not.toBeVisible();
  expect(JSON.parse(fs.readFileSync(path.join(root, "settings.json"))).shortcuts.paste).toBe("Ctrl+Shift+V");
});

test("shortcut save failures keep the draft and explain how to retry", async () => {
  await openShortcuts();
  await recordShortcut("新建标签页", "Control+Alt+N");
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get("terminal:saveShortcuts");
    let first = true;
    ipcMain.removeHandler("terminal:saveShortcuts");
    ipcMain.handle("terminal:saveShortcuts", (...args) => {
      if (first) { first = false; throw Error("保存失败，请重试"); }
      return original(...args);
    });
  });
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect(page.locator("#shortcuts-error")).toContainText("保存失败，请重试");
  await expect(page.locator("#shortcuts")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建标签页快捷键", exact: true })).toHaveText("Ctrl+Alt+N");
  await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
  await expect(page.locator("#shortcuts")).not.toBeVisible();
  await page.keyboard.press("Control+Alt+N");
  await expect(page.getByRole("tab")).toHaveCount(2);
});

async function launchAgainForRecovery() {
  app = await electron.launch({
    executablePath: process.env.TERMINAL_TEST_EXECUTABLE,
    args: [
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      ...(process.env.TERMINAL_TEST_EXECUTABLE ? [] : [path.join(__dirname, "../src/main.cjs")]),
    ],
    env: { ...process.env, TERMINAL_CONFIG_ROOT: root },
  });
  page = await app.firstWindow();
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
}
function savedRecoveryWorkspace() {
  try {
    return fs.readdirSync(path.join(root, "recovery"))
      .filter(name => name.endsWith(".json"))
      .map(name => JSON.parse(fs.readFileSync(path.join(root, "recovery", name), "utf8")))
      .filter(record => record.workspace)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]?.workspace;
  } catch { return null; }
}
async function crashTerminal() {
  const child = app.process();
  // Playwright launches Electron through cmd.exe on Windows. Killing only
  // child leaves the actual app alive, so its checkpoint must not be recovered.
  const ownerPid = await app.evaluate(() => process.pid);
  const exited = new Promise(resolve => child.once("exit", resolve));
  if (process.platform === "win32") {
    require("node:child_process").execFileSync("taskkill", ["/PID", String(ownerPid), "/T", "/F"], { windowsHide: true });
  } else child.kill("SIGKILL");
  await exited;
  await expect.poll(() => {
    try { process.kill(ownerPid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
  }).toBe(false);
}

test("crash recovery restores nested splits, tab names, focus and directories without replaying commands", async () => {
  test.setTimeout(60000);
  const folder = path.join(root, "recover-project");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "restore-directory-marker"), root);
  await page.keyboard.type(process.platform === "win32" ? `Set-Location -LiteralPath '${folder.replaceAll("'", "''")}'` : `cd '${folder.replaceAll("'", "'\\''")}'`);
  await page.keyboard.press("Enter");
  await waitForIdleTerminal();
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(2);
  await waitForIdleTerminal();
  const divider = page.getByRole("separator").first();
  await divider.focus(); await divider.press("Home"); await divider.press("ArrowRight");
  await page.locator(".terminal-pane.active .xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Shift+J");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(3);
  await waitForIdleTerminal();
  await page.keyboard.press("Control+Shift+R");
  await page.locator("#tab-name").fill("恢复项目"); await page.keyboard.press("Enter");
  await expect(page.getByRole("tab")).toHaveText("恢复项目");
  await page.keyboard.press("Control+Shift+T");
  await expect(page.getByRole("tab")).toHaveCount(2); await waitForIdleTerminal();
  await page.keyboard.press("Control+Shift+R");
  await page.locator("#tab-name").fill("后台任务"); await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "恢复项目", exact: true }).click();
  const marker = path.join(folder, "command-runs");
  await page.keyboard.type(process.platform === "win32"
    ? `Add-Content -LiteralPath '${marker.replaceAll("'", "''")}' -Value 'once'; Start-Sleep -Seconds 120`
    : `printf 'once\\n' >> '${marker.replaceAll("'", "'\\''")}'; sleep 120`);
  await page.keyboard.press("Enter");
  await expect.poll(() => fs.existsSync(marker)).toBe(true);
  await expect.poll(() => savedRecoveryWorkspace()?.tabs.map(t => t.title)).toEqual(["恢复项目", "后台任务"]);
  await expect.poll(() => savedRecoveryWorkspace()?.tabs[0].layout.ratio).toBe(20);
  await expect.poll(() => savedRecoveryWorkspace()?.activeTab).toBe(savedRecoveryWorkspace().tabs[0].id);
  const before = savedRecoveryWorkspace();
  expect(before.activeTab).toBe(before.tabs[0].id);
  await crashTerminal(); await launchAgainForRecovery();
  await expect(page.getByRole("dialog", { name: "恢复上次的终端？", exact: true })).toBeVisible();
  await expect(page.locator("#recovery-summary")).toHaveText("2 个标签页 · 4 个面板");
  await page.getByRole("button", { name: "恢复会话", exact: true }).click();
  await expect(page.locator("#recovery")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveText(["恢复项目", "后台任务"]);
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".terminal-pane:visible")).toHaveCount(3);
  await expect(page.getByRole("separator").first()).toHaveAttribute("aria-valuenow", "20");
  await expect(page.locator(".terminal-pane:visible").nth(2)).toHaveClass(/active/);
  await waitForIdleTerminal();
  const directories = await page.locator(".terminal-pane").evaluateAll(async panes => Promise.all(panes.map(async pane => (await window.terminalAPI.sessionInfo(pane.id.slice(9))).cwd)));
  for (const cwd of directories) expect(fs.readFileSync(path.join(cwd, "restore-directory-marker"), "utf8")).toBe(root);
  expect(fs.readFileSync(marker, "utf8").trim()).toBe("once");
});

test("normal exit does not offer recovery and an unanswered recovery prompt survives closing", async () => {
  await expect.poll(() => savedRecoveryWorkspace()?.tabs.length).toBe(1);
  await app.close(); await launchAgainForRecovery();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator("#recovery")).not.toBeVisible();
  await waitForIdleTerminal();
  await page.keyboard.press("Control+Shift+T"); await expect(page.getByRole("tab")).toHaveCount(2);
  await expect.poll(() => savedRecoveryWorkspace()?.tabs.length).toBe(2);
  await crashTerminal(); await launchAgainForRecovery();
  await expect(page.locator("#recovery")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#recovery")).toBeVisible();
  await expect(page.locator("#recovery-summary")).toHaveText("2 个标签页 · 2 个面板");
  await app.close(); await launchAgainForRecovery();
  await expect(page.locator("#recovery")).toBeVisible();
  await page.getByRole("button", { name: "新建终端", exact: true }).click();
  await expect(page.locator("#recovery")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect.poll(() => savedRecoveryWorkspace()?.tabs.length).toBe(1);
});

test("recovery falls back from missing directories and unavailable shells and ignores corrupt records", async () => {
  const oldPid = app.process().pid;
  await app.close();
  fs.mkdirSync(path.join(root, "recovery"), { recursive: true });
  const layout = { version: 1, activeTab: "tab-old", tabs: [{ id: "tab-old", title: "目录已删除", activePane: "pane-old", layout: {
    type: "pane", id: "pane-old", cwd: path.join(root, "does-not-exist"), shell: "missing-shell",
  } }] };
  fs.writeFileSync(path.join(root, "recovery", `window-${oldPid}-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json`), JSON.stringify({ version: 1, pid: oldPid, updatedAt: new Date().toISOString(), workspace: layout }));
  fs.writeFileSync(path.join(root, "recovery", `window-${oldPid}-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.json`), "{broken");
  await launchAgainForRecovery(); await expect(page.locator("#recovery")).toBeVisible();
  await page.getByRole("button", { name: "恢复会话", exact: true }).click();
  await expect(page.locator("#recovery")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveText("目录已删除");
  await waitForIdleTerminal();
  await expect(page.locator("#status")).toContainText("改用主目录或默认 Shell");
  const cwd = await page.evaluate(async () => (await window.terminalAPI.sessionInfo(document.querySelector(".terminal-pane.active").id.slice(9))).cwd);
  expect({ dev: fs.statSync(cwd).dev, ino: fs.statSync(cwd).ino }).toEqual({ dev: fs.statSync(os.homedir()).dev, ino: fs.statSync(os.homedir()).ino });
});

test("a renderer crash keeps the last workspace recoverable", async () => {
  test.setTimeout(60000);
  await page.keyboard.press("Control+Shift+T"); await expect(page.getByRole("tab")).toHaveCount(2);
  await expect.poll(() => savedRecoveryWorkspace()?.tabs.length).toBe(2);
  const child = app.process(), exited = new Promise(resolve => child.once("exit", resolve));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()).catch(() => {});
  await exited; await launchAgainForRecovery();
  await expect(page.locator("#recovery")).toBeVisible();
  await page.getByRole("button", { name: "恢复会话", exact: true }).click();
  await expect(page.locator("#recovery")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("a failed restoration preserves the original record and can be retried", async () => {
  test.setTimeout(60000);
  await page.keyboard.press("Control+Shift+T"); await expect(page.getByRole("tab")).toHaveCount(2);
  await expect.poll(() => savedRecoveryWorkspace()?.tabs.length).toBe(2);
  await crashTerminal(); await launchAgainForRecovery();
  await expect(page.locator("#recovery")).toBeVisible();
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get("terminal:saveWorkspace");
    let first = true;
    ipcMain.removeHandler("terminal:saveWorkspace");
    ipcMain.handle("terminal:saveWorkspace", (...args) => {
      if (first) { first = false; throw Error("恢复记录写入失败"); }
      return original(...args);
    });
  });
  await page.getByRole("button", { name: "恢复会话", exact: true }).click();
  await expect(page.locator("#recovery-error")).toContainText("恢复记录写入失败");
  await expect(page.locator("#recovery")).toBeVisible();
  expect(savedRecoveryWorkspace().tabs).toHaveLength(2);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.getByRole("button", { name: "恢复会话", exact: true }).click();
  await expect(page.locator("#recovery")).not.toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(2);
});
