import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { palette, profiles, presets, color } from "./appearance.js";
import { installPrompt, recolorPrompt } from "./prompt.js";
const api = window.terminalAPI,
  $ = (id) => document.getElementById(id),
  sessions = new Map(),
  earlyOutput = new Map();
let settings,
  bootstrap,
  active,
  drag,
  original,
  wallpaperURL = null,
  renamed,
  preferencesEpoch = 0;
const bytes = new TextEncoder();
let savedFontSize = 12;
function error(err) {
  $("status").textContent = `错误：${err.message || err}`;
}
function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      error(err);
    }
  };
}
function current() {
  return sessions.get(active);
}
async function copySelection() {
  const s = current();
  const text = s?.term.getSelection();
  if (text) await api.writeClipboard(text);
  if (s === current()) s?.term.focus();
}
async function pasteClipboard() {
  const s = current();
  if (!s || s.exited) return;
  const text = await api.readClipboard();
  if (sessions.get(s.id) !== s || s.exited) return;
  s.term.paste(text);
  if (s === current()) s.term.focus();
}
function fit(s = current()) {
  if (!s || s.id !== active || s.exited) return;
  try {
    s.fit.fit();
    api.resize(s.id, s.term.cols, s.term.rows).catch(error);
  } catch (err) {
    error(err);
  }
}
function apply(value) {
  settings = { ...value };
  const p = palette(settings);
  document.body.style.setProperty("--terminal-bg", p.background);
  document.body.classList.toggle("light", settings.profile === "Basic");
  document.body.style.setProperty(
    "--wallpaper-opacity",
    settings.wallpaper_opacity,
  );
  document.body.style.setProperty(
    "--wallpaper",
    wallpaperURL ? `url("${wallpaperURL}")` : "none",
  );
  for (const s of sessions.values()) {
    s.term.options.theme = {
      ...p,
      background: wallpaperURL ? "#00000000" : p.background,
    };
    s.term.options.fontFamily = settings.font_family;
    s.term.options.fontSize = Number(settings.font_size);
    s.promptColors ??= new Set();
    if (s.promptColor) s.promptColors.add(parseInt(s.promptColor.slice(1), 16));
    s.promptColors.add(parseInt(settings.username_color.slice(1), 16));
    s.promptColor = settings.username_color;
    recolorPrompt(s, settings.username_color);
  }
  requestAnimationFrame(() => fit());
}
function switchTab(id) {
  active = id;
  for (const s of sessions.values()) {
    s.pane.classList.toggle("active", s.id === id);
    s.wrap.classList.toggle("selected", s.id === id);
    s.tab.setAttribute("aria-selected", String(s.id === id));
    s.tab.tabIndex = s.id === id ? 0 : -1;
  }
  fit();
  current()?.term.focus();
}
async function closeTab(id) {
  const s = sessions.get(id);
  if (!s) return;
  const info = s.exited ? { busy: false } : await api.sessionInfo(id);
  if (info.busy && !(await api.confirmClose())) return;
  if (!s.exited) await api.closeSession(id);
  s.term.dispose();
  s.pane.remove();
  s.wrap.remove();
  sessions.delete(id);
  if (active === id) {
    const next = sessions.keys().next().value;
    if (next) switchTab(next);
    else await newTab();
  }
}
function renameTab(id) {
  renamed = id;
  $("tab-name").value = sessions.get(id).tab.textContent;
  $("rename").showModal();
  $("tab-name").select();
}
async function newTab() {
  const parent = current();
  let cwd = parent?.cwd;
  if (parent) {
    try {
      cwd = (await api.sessionInfo(parent.id)).cwd || cwd;
    } catch {}
  }
  const info = await api.createSession({
    cwd,
    shell: settings.shell,
    cols: 80,
    rows: 24,
  });
  const pane = document.createElement("section");
  pane.className = "terminal-pane";
  pane.setAttribute("role", "tabpanel");
  pane.id = `terminal-${info.id}`;
  $("terminals").append(pane);
  const term = new Terminal({
    allowTransparency: true,
    theme: palette(settings),
    fontFamily: settings.font_family,
    fontSize: Number(settings.font_size),
    cursorBlink: true,
    scrollback: 10000,
  });
  const fitAddon = new FitAddon(),
    search = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(search);
  term.open(pane);
  const wrap = document.createElement("div");
  wrap.className = "tab-wrap";
  wrap.draggable = true;
  const tab = document.createElement("button");
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", pane.id);
  tab.textContent = info.label;
  const close = document.createElement("button");
  close.className = "tab-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "关闭标签页");
  wrap.append(tab, close);
  $("tabs").append(wrap);
  const s = {
    ...info,
    term,
    fit: fitAddon,
    search,
    pane,
    wrap,
    tab,
    custom: false,
  };
  sessions.set(info.id, s);
  installPrompt(s);
  for (const data of earlyOutput.get(info.id) || [])
    term.write(data, () =>
      api.ack(info.id, bytes.encode(data).length).catch(error),
    );
  earlyOutput.delete(info.id);
  term.onData((data) => {
    if (data.includes("\r")) s.idle = false;
    api.write(info.id, data).catch(error);
  });
  term.onTitleChange((title) => {
    s.autoTitle = title.trim().slice(0, 80) || s.label;
    if (!s.custom) tab.textContent = s.autoTitle;
  });
  tab.onclick = () => switchTab(info.id);
  tab.ondblclick = () => renameTab(info.id);
  tab.onkeydown = (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const ids = [...$("tabs").children].map(
        (el) => [...sessions.values()].find((s) => s.wrap === el)?.id,
      );
      switchTab(
        ids[
          (ids.indexOf(info.id) +
            (event.key === "ArrowRight" ? 1 : -1) +
            ids.length) %
            ids.length
        ],
      );
    }
    if (event.key === "F2") renameTab(info.id);
  };
  close.onclick = guard(() => closeTab(info.id));
  wrap.ondragstart = () => {
    drag = wrap;
  };
  wrap.ondragover = (e) => e.preventDefault();
  wrap.ondrop = (e) => {
    e.preventDefault();
    if (drag && drag !== wrap) $("tabs").insertBefore(drag, wrap);
  };
  term.attachCustomKeyEventHandler(
    (event) =>
      !(
        event.type === "keydown" &&
        event.ctrlKey &&
        ((event.shiftKey &&
          ["C", "V", "T", "W", "F", "R"].includes(event.key.toUpperCase())) ||
          ["PageUp", "PageDown", ",", "+", "=", "-", "0"].includes(event.key))
      ),
  );
  switchTab(info.id);
  apply(settings);
}
api.onOutput(({ id, data }) => {
  const s = sessions.get(id);
  if (s)
    s.term.write(data, () => {
      api.ack(id, bytes.encode(data).length).catch(error);
      recolorPrompt(s, s.promptColor);
    });
  else {
    const pending = earlyOutput.get(id) || [];
    pending.push(data);
    earlyOutput.set(id, pending);
  }
});
api.onExit(({ id, exitCode }) => {
  const s = sessions.get(id);
  if (s) {
    s.exited = true;
    s.idle = false;
    s.term.write(`\r\n[进程已退出：${exitCode}]\r\n`);
    s.tab.textContent += " · 已退出";
  }
});
$("new").onclick = guard(newTab);
$("tabs").ondblclick = guard((event) => {
  if (event.target === $("tabs")) return newTab();
});
for (const action of ["close", "minimize", "maximize"])
  document.querySelector(`.traffic.${action}`).onclick = guard(() =>
    api.windowAction(action),
  );
$("rename").addEventListener("close", () => {
  if ($("rename").returnValue === "save") {
    const s = sessions.get(renamed);
    const title = $("tab-name").value.trim();
    if (s) {
      s.custom = Boolean(title);
      s.tab.textContent = title || s.autoTitle || s.label;
    }
  }
  current()?.term.focus();
});
function search(back = false) {
  const s = current();
  if (!s) return;
  const found = back
    ? s.search.findPrevious($("query").value)
    : s.search.findNext($("query").value);
  $("status").textContent = found ? "找到匹配内容" : "没有找到匹配内容";
}
$("search-open").onclick = () => {
  $("search").hidden = false;
  $("query").focus();
};
$("search").onsubmit = (e) => {
  e.preventDefault();
  search();
};
$("search-prev").onclick = () => search(true);
function hideSearch() {
  $("search").hidden = true;
  $("status").textContent = "";
  current()?.search.clearDecorations();
  current()?.term.focus();
}
$("search-close").onclick = hideSearch;
const form = $("settings-form");
function values() {
  const next = { ...settings };
  for (const name of [
    "profile",
    "font_family",
    "font_size",
    "shell",
    "background",
    "username_color",
    "wallpaper_opacity",
  ])
    next[name] = form.elements[name].value;
  if (next.background && !color(next.background))
    throw Error("请输入有效的背景颜色，如 #17191e");
  if (!color(next.username_color)) throw Error("请输入有效的用户名颜色");
  next.background = color(next.background);
  next.username_color = color(next.username_color);
  next.font_size = Number(next.font_size);
  next.wallpaper_opacity = Number(next.wallpaper_opacity);
  if (next.font_size < 8 || next.font_size > 32)
    throw Error("字体大小范围为 8–32");
  return next;
}
function populate() {
  for (const name of [
    "profile",
    "font_family",
    "font_size",
    "shell",
    "background",
    "username_color",
    "wallpaper_opacity",
  ])
    form.elements[name].value = settings[name] ?? "";
  $("settings-error").textContent = "";
}
$("settings-open").onclick = () => {
  preferencesEpoch++;
  original = { ...settings, wallpaperURL };
  populate();
  $("settings").showModal();
};
form.oninput = () => {
  try {
    apply(values());
    $("settings-error").textContent = "";
  } catch (err) {
    $("settings-error").textContent = err.message;
  }
};
form.elements.profile.onchange = () => {
  form.elements.background.value =
    profiles[form.elements.profile.value].background;
  form.oninput();
};
$("username-preset").onchange = () => {
  if ($("username-preset").value) {
    form.elements.username_color.value = $("username-preset").value;
    form.oninput();
  }
};
$("background-preset").onchange = () => {
  if ($("background-preset").value) {
    form.elements.background.value = $("background-preset").value;
    form.oninput();
  }
};
$("settings-cancel").onclick = () => {
  $("settings").close("cancel");
};
$("settings").addEventListener(
  "close",
  guard(async () => {
    preferencesEpoch++;
    if ($("settings").returnValue !== "saved" && original) {
      wallpaperURL = original.wallpaperURL;
      const restore = { ...original };
      delete restore.wallpaperURL;
      apply(restore);
      await api.discardWallpapers();
    }
    current()?.term.focus();
  }),
);
form.onsubmit = async (e) => {
  e.preventDefault();
  try {
    const next = values();
    const persisted = await api.saveSettings(next);
    savedFontSize = persisted.font_size;
    apply(persisted);
    $("settings").close("saved");
  } catch (err) {
    $("settings-error").textContent = err.message;
  }
};
$("wallpaper-import").onclick = guard(async () => {
  const epoch = preferencesEpoch;
  const image = await api.importWallpaper();
  if (epoch !== preferencesEpoch || !$("settings").open) {
    await api.discardWallpapers();
    return;
  }
  if (image) {
    wallpaperURL = image.url;
    settings.wallpaper = image.path;
    apply(values());
  }
});
$("wallpaper-remove").onclick = () => {
  wallpaperURL = null;
  settings.wallpaper = null;
  apply(values());
};
$("menu").addEventListener("toggle", (event) =>
  $("menu-open").setAttribute(
    "aria-expanded",
    String(event.newState === "open"),
  ),
);
$("menu").onclick = guard(async (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  $("menu").hidePopover();
  if (action === "copy") await copySelection();
  if (action === "paste") await pasteClipboard();
  if (action === "selectall") {
    current()?.term.selectAll();
    current()?.term.focus();
  }
  if (action === "rename" && active) renameTab(active);
  if (action === "search") $("search-open").click();
  if (action === "settings") $("settings-open").click();
  if (action === "about") $("about").showModal();
});
document.addEventListener(
  "keydown",
  guard(async (event) => {
    if (event.key === "Escape" && !$("search").hidden) {
      hideSearch();
      return;
    }
    if (document.querySelector("dialog[open]")) return;
    const key = event.key.toUpperCase();
    if (
      event.ctrlKey && !event.altKey && !event.metaKey &&
      (key === "V" || (key === "C" && (event.shiftKey || current()?.term.hasSelection())))
    ) {
      // Leave search and other editable fields to native clipboard handling.
      if (
        event.target.closest("input, textarea, [contenteditable]") &&
        !event.target.classList.contains("xterm-helper-textarea")
      ) return;
      // Capture before xterm can send Ctrl+V/C to the shell or paste a second time.
      event.preventDefault();
      event.stopPropagation();
      if (key === "C") await copySelection();
      else await pasteClipboard();
      return;
    }
    if (event.ctrlKey && (!event.shiftKey || event.key === "+")) {
      if (["PageUp", "PageDown"].includes(event.key)) {
        event.preventDefault();
        const ids = [...$("tabs").children].map(
          (el) => [...sessions.values()].find((s) => s.wrap === el)?.id,
        );
        switchTab(
          ids[
            (ids.indexOf(active) +
              (event.key === "PageDown" ? 1 : -1) +
              ids.length) %
              ids.length
          ],
        );
        return;
      }
      if (event.key === ",") {
        event.preventDefault();
        $("settings-open").click();
        return;
      }
      if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        apply({
          ...settings,
          font_size:
            event.key === "0"
              ? savedFontSize
              : Math.max(
                  8,
                  Math.min(
                    32,
                    settings.font_size + (event.key === "-" ? -1 : 1),
                  ),
                ),
        });
        return;
      }
    }
    if (!event.ctrlKey || !event.shiftKey) return;
    if (["T", "W", "F", "R"].includes(key)) event.preventDefault();
    if (key === "R" && active) renameTab(active);
    if (key === "T") await newTab();
    if (key === "W" && active) await closeTab(active);
    if (key === "F") $("search-open").click();
  }),
  true,
);
new ResizeObserver(() => fit()).observe($("terminals"));
guard(async () => {
  bootstrap = await api.bootstrap();
  settings = bootstrap.settings;
  savedFontSize = settings.font_size;
  for (const name of bootstrap.fonts) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    $("font-list").append(o);
  }
  if (!bootstrap.fonts.includes(settings.font_family)) {
    const o = document.createElement("option");
    o.textContent = settings.font_family;
    $("font-list").append(o);
  }
  for (const shell of bootstrap.shells) {
    const o = document.createElement("option");
    o.value = shell.id;
    o.textContent = shell.label;
    form.elements.shell.append(o);
  }
  for (const [label, value] of Object.entries(presets)) {
    const o = document.createElement("option");
    o.textContent = label;
    o.value = value;
    $("background-preset").append(o);
  }
  wallpaperURL = await api.wallpaper();
  apply(settings);
  await newTab();
})();
