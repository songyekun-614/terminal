const { test, expect, _electron: electron } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
let app, page, root;
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
  try {
    await expect(page.getByRole("tab")).toHaveCount(1, { timeout: 15000 });
    await waitForIdleTerminal();
  } catch (error) {
    console.error("Terminal startup status:", await page.locator("#status").textContent());
    throw error;
  }
});
test.afterEach(async () => {
  if (app) {
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});}).catch(()=>{});
    await app.close();
  }
  fs.rmSync(root, { recursive: true, force: true });
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
  await expect(page.getByText("Stay focused", { exact: true })).toBeVisible();
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

test("Escape closes only the active tab and restores terminal focus", async () => {
  await page.getByRole("button", { name: "新建标签页", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await waitForIdleTerminal();
  const activePane = await page.locator(".terminal-pane.active").getAttribute("id");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(`[id="${activePane}"]`)).toHaveCount(0);
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
});

test("Escape on the final idle tab exits the terminal window", async () => {
  await waitForIdleTerminal();
  const closed = page.waitForEvent("close");
  await page.keyboard.press("Escape").catch(error => {
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

test("held Escape does not close another tab", async () => {
  await page.getByRole("button", { name: "新建标签页", exact: true }).click();
  await waitForIdleTerminal();
  await page.keyboard.down("Escape");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.keyboard.down("Escape");
  await page.keyboard.up("Escape");
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("Escape on the last busy tab honors cancellation and confirmation", async () => {
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
  await page.keyboard.press("Escape");
  await expect.poll(() => app.evaluate(() => global.escapeConfirmations)).toBe(1);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  const closed = page.waitForEvent("close");
  await page.keyboard.press("Escape").catch(error => {
    if (!page.isClosed()) throw error;
  });
  await closed;
  expect(page.isClosed()).toBe(true);
});

test("Escape while a busy tab confirmation is pending cannot close another tab", async () => {
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
  await page.keyboard.press("Escape");
  await expect.poll(() => app.evaluate(() => global.escapeConfirmations)).toBe(1);
  await page.keyboard.press("Escape");
  expect(await app.evaluate(() => global.escapeConfirmations)).toBe(1);
  await app.evaluate(() => global.resolveEscapeConfirmation({ response: 1 }));
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".terminal-pane.active .xterm-helper-textarea")).toBeFocused();
});
