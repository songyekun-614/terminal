import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { palette, profiles, presets, color } from "./appearance.js";
import { installPrompt, recolorPrompt } from "./prompt.js";
import { splitLayout, removePaneLayout } from "./splits.js";
import escapeModel from "../src/escape.cjs";
const { escapeAction } = escapeModel;
const api = window.terminalAPI,
  $ = (id) => document.getElementById(id),
  sessions = new Map(),
  tabs = new Map(),
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
let closingLayout = false;
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
function enqueueInput(s, operation) {
  const queued = (s.inputQueue || Promise.resolve())
    .then(() => {
      if (sessions.get(s.id) === s && !s.exited) return operation();
    })
    .catch(error);
  s.inputQueue = queued;
  queued.then(() => {
    if (s.inputQueue === queued) s.inputQueue = null;
  });
  return queued;
}
async function pasteClipboard() {
  const s = current();
  if (!s || s.exited) return;
  return enqueueInput(s, async () => {
    const text = await api.readClipboard();
    if (sessions.get(s.id) !== s || s.exited) return;
    // Keep xterm's newline and bracketed-paste handling, then send its data
    // before the keystrokes queued while the clipboard was being read.
    const input = [];
    s.clipboardInput = input;
    try {
      s.term.paste(text);
    } finally {
      s.clipboardInput = null;
    }
    for (const data of input) await api.write(s.id, data);
    if (s === current()) s.term.focus();
  });
}
function fit(s) {
  if (!s) {
    for (const pane of sessions.values()) fit(pane);
    return;
  }
  if (s.owner.root.hidden || s.exited) return;
  try {
    s.fit.fit();
    api.resize(s.id, s.term.cols, s.term.rows).catch(error);
  } catch (err) { error(err); }
}
let fitFrame;
function scheduleFit() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => fit());
}
const paneResize = new ResizeObserver(scheduleFit);
function tabFor(id) { return tabs.get(id) || sessions.get(id)?.owner; }
function updateTitle(group) {
  const pane = sessions.get(group.active);
  group.tab.textContent = group.custom || pane?.autoTitle || pane?.label || "终端";
}
function focusPane(id, focus = true) {
  const pane = sessions.get(id);
  if (!pane) return;
  active = id;
  pane.owner.active = id;
  for (const group of tabs.values()) {
    const selected = group === pane.owner;
    group.root.hidden = !selected;
    group.wrap.classList.toggle("selected", selected);
    group.tab.setAttribute("aria-selected", String(selected));
    group.tab.tabIndex = selected ? 0 : -1;
  }
  for (const s of sessions.values()) s.pane.classList.toggle("active", s.id === id);
  updateTitle(pane.owner);
  scheduleFit();
  if (focus) pane.term.focus();
}
function nextPane() {
  const group = current()?.owner;
  if (!group) return;
  const ids = [...group.root.querySelectorAll(".terminal-pane")].map(el => el.id.slice(9));
  focusPane(ids[(ids.indexOf(active) + 1) % ids.length]);
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
  const group = tabFor(id);
  if (group && !group.closing) focusPane(group.active);
}
async function busy(panes) {
  const states = await Promise.all(panes.map(async s => {
    if (s.exited) return false;
    try { return (await api.sessionInfo(s.id)).busy; }
    catch (err) { if (s.exited) return false; throw err; }
  }));
  return states.some(Boolean);
}
async function disposePane(s) {
  if (!s.exited) {
    try { await api.closeSession(s.id); }
    catch (err) { if (!s.exited) throw err; }
  }
  paneResize.unobserve(s.content);
  s.term.dispose();
  sessions.delete(s.id);
  s.owner.panes.delete(s.id);
}
async function closeTab(id, { closeWindow = false } = {}) {
  const group = tabFor(id);
  if (!group || group.closing || creating || closingLayout) return;
  closingLayout = true;
  group.closing = true;
  try {
    if (closeWindow && tabs.size === 1) {
      await api.windowAction("close");
      return;
    }
    const panes = [...group.panes].map(id => sessions.get(id));
    if (await busy(panes) && !(await api.confirmClose())) return;
    for (const pane of panes) await disposePane(pane);
    const selected = panes.some(pane => pane.id === active);
    group.root.remove();
    group.wrap.remove();
    tabs.delete(group.id);
    if (selected) {
      const next = tabs.keys().next().value;
      if (next) switchTab(next);
      else { active = null; await newTab(); }
    }
  } finally { group.closing = false; closingLayout = false; }
}
async function closePane(id = active, { closeWindow = false } = {}) {
  const s = sessions.get(id);
  if (!s || s.owner.closing || creating || closingLayout) return;
  if (s.owner.panes.size === 1) return closeTab(s.owner.id, { closeWindow });
  closingLayout = true;
  const group = s.owner;
  group.closing = true;
  try {
    if (await busy([s]) && !(await api.confirmClose())) return;
    const ids = [...group.root.querySelectorAll(".terminal-pane")].map(el => el.id.slice(9));
    const next = ids[ids.indexOf(id) + 1] || ids[ids.indexOf(id) - 1];
    await disposePane(s);
    removePaneLayout(s.pane);
    group.root.classList.toggle("has-splits", group.panes.size > 1);
    if (group.active === id) group.active = next;
    if (active === id) focusPane(next);
    updateTitle(group);
    scheduleFit();
  } finally { group.closing = false; closingLayout = false; }
}
function renameTab(id) {
  const group = tabFor(id);
  if (!group) return;
  renamed = group.id;
  $("tab-name").value = group.tab.textContent;
  $("rename").showModal();
  $("tab-name").select();
}
let creating = false;
async function createPane(group, parent = current(), direction) {
  let cwd = parent?.cwd;
  if (parent && !parent.exited) {
    try { cwd = (await api.sessionInfo(parent.id)).cwd || cwd; } catch {}
  }
  const info = await api.createSession({ cwd, shell: settings.shell, cols: 80, rows: 24 });
  if (tabs.get(group.id) !== group || (direction && sessions.get(parent.id) !== parent)) {
    await api.closeSession(info.id);
    earlyOutput.delete(info.id);
    return;
  }
  const pane = document.createElement("section");
  pane.className = "terminal-pane";
  pane.setAttribute("role", "group");
  pane.setAttribute("aria-label", "终端面板");
  pane.id = `terminal-${info.id}`;
  const heading = document.createElement("div");
  heading.className = "pane-heading";
  const title = document.createElement("span");
  title.textContent = info.label;
  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "关闭此面板");
  close.title = "关闭此面板 · Ctrl+Shift+X";
  heading.append(title, close);
  const content = document.createElement("div");
  content.className = "terminal-content";
  pane.append(heading, content);
  if (direction) splitLayout(parent.pane, pane, direction, scheduleFit);
  else group.root.append(pane);
  const term = new Terminal({
    allowTransparency: true, theme: palette(settings),
    fontFamily: settings.font_family, fontSize: Number(settings.font_size),
    cursorBlink: true, scrollback: 10000,
  });
  const fitAddon = new FitAddon(), search = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(search);
  term.open(content);
  const s = { ...info, term, fit: fitAddon, search, pane, content, paneTitle: title, owner: group };
  sessions.set(info.id, s);
  group.panes.add(info.id);
  group.root.classList.toggle("has-splits", group.panes.size > 1);
  installPrompt(s);
  for (const data of earlyOutput.get(info.id) || [])
    term.write(data, () => api.ack(info.id, bytes.encode(data).length).catch(error));
  earlyOutput.delete(info.id);
  term.onData(data => {
    if (data.includes("\r")) s.idle = false;
    if (s.clipboardInput) s.clipboardInput.push(data);
    else if (s.inputQueue) enqueueInput(s, () => api.write(info.id, data));
    else api.write(info.id, data).catch(error);
  });
  term.onTitleChange(title => {
    s.autoTitle = title.trim().slice(0, 80) || s.label;
    s.paneTitle.textContent = s.autoTitle;
    if (group.active === s.id) updateTitle(group);
  });
  pane.onpointerdown = event => {
    if (event.target.closest("button")) return;
    if (event.target.closest(".pane-heading")) {
      event.preventDefault();
      focusPane(s.id);
    } else focusPane(s.id, false);
  };
  content.addEventListener("focusin", () => { if (active !== s.id) focusPane(s.id, false); });
  close.onclick = guard(() => closePane(s.id));
  term.attachCustomKeyEventHandler(event => !(
    event.type === "keydown" && event.ctrlKey &&
    ((event.shiftKey && ["C", "V", "T", "W", "F", "R", "H", "J", "O", "X"].includes(event.key.toUpperCase())) ||
     ["PageUp", "PageDown", ",", "+", "=", "-", "0"].includes(event.key))
  ));
  paneResize.observe(content);
  focusPane(info.id);
  apply(settings);
  return s;
}
async function splitPane(direction) {
  const parent = current();
  if (!parent || creating || parent.owner.closing) return;
  let depth = 0;
  for (let node = parent.pane.parentElement; node !== parent.owner.root; node = node.parentElement) depth++;
  if (depth >= 8) throw Error("最多嵌套 8 层分屏");
  const box = parent.pane.getBoundingClientRect();
  if ((direction === "horizontal" ? box.width : box.height) < 240)
    throw Error("面板空间不足，请先调整分隔线或放大窗口");
  creating = true;
  try { await createPane(parent.owner, parent, direction); }
  finally { creating = false; }
}
async function newTab() {
  if (creating) return;
  creating = true;
  const parent = current();
  const root = document.createElement("div");
  root.className = "terminal-tab";
  root.setAttribute("role", "tabpanel");
  const id = crypto.randomUUID();
  root.id = `tab-${id}`;
  root.hidden = true;
  $("terminals").append(root);
  const wrap = document.createElement("div");
  wrap.className = "tab-wrap";
  wrap.draggable = true;
  const tab = document.createElement("button");
  tab.id = `tab-label-${id}`;
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", root.id);
  root.setAttribute("aria-labelledby", tab.id);
  const close = document.createElement("button");
  close.className = "tab-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "关闭标签页");
  wrap.append(tab, close);
  $("tabs").append(wrap);
  const group = { id, root, wrap, tab, panes: new Set(), active: null, custom: "" };
  tabs.set(id, group);
  tab.onclick = () => switchTab(id);
  tab.ondblclick = () => renameTab(id);
  tab.onkeydown = event => {
    if (["ArrowRight", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      const ids = tabOrder();
      switchTab(ids[(ids.indexOf(id) + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length]);
    }
    if (event.key === "F2") renameTab(id);
  };
  close.onclick = guard(() => closeTab(id));
  wrap.ondragstart = () => { drag = wrap; };
  wrap.ondragover = e => e.preventDefault();
  wrap.ondrop = e => {
    e.preventDefault();
    if (drag && drag !== wrap && drag.parentElement === $("tabs")) $("tabs").insertBefore(drag, wrap);
  };
  try { await createPane(group, parent); }
  catch (err) {
    root.remove(); wrap.remove(); tabs.delete(id);
    if (parent) focusPane(parent.id);
    throw err;
  } finally { creating = false; }
}
function tabOrder() {
  return [...$("tabs").children].map(el => [...tabs.values()].find(group => group.wrap === el)?.id).filter(Boolean);
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
    s.autoTitle = (s.autoTitle || s.label) + " · 已退出";
    s.paneTitle.textContent = s.autoTitle;
    if (s.owner.active === s.id) updateTitle(s.owner);
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
    const group = tabs.get(renamed);
    const title = $("tab-name").value.trim();
    if (group) {
      group.custom = title;
      updateTitle(group);
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
  for (const s of sessions.values()) s.search.clearDecorations();
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
$("about").addEventListener("close", () => current()?.term.focus());
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
    const dialog = document.querySelector("dialog[open]");
    const escape = escapeAction(event, {
      dialog: Boolean(dialog),
      menu: $("menu").matches(":popover-open"),
      search: !$("search").hidden,
    });
    if (escape) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (escape === "dialog") dialog.close("cancel");
      else if (escape === "menu") {
        $("menu").hidePopover();
        current()?.term.focus();
      }
      else hideSearch();
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
        const ids = tabOrder();
        switchTab(ids[(ids.indexOf(current()?.owner.id) + (event.key === "PageDown" ? 1 : -1) + ids.length) % ids.length]);
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
    if (["T", "W", "F", "R", "H", "J", "O", "X"].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (["H", "J", "O", "X"].includes(key)) {
      if (event.repeat || event.altKey || event.metaKey || event.isComposing) return;
      if (key === "H") await splitPane("horizontal");
      if (key === "J") await splitPane("vertical");
      if (key === "O") nextPane();
      if (key === "X") await closePane();
      return;
    }
    if (key === "R" && active) renameTab(active);
    if (key === "T") await newTab();
    if (key === "W" && active) await closeTab(active);
    if (key === "F") $("search-open").click();
  }),
  true,
);
$("split-horizontal").onclick = guard(() => splitPane("horizontal"));
$("split-vertical").onclick = guard(() => splitPane("vertical"));
$("next-pane").onclick = nextPane;
new ResizeObserver(scheduleFit).observe($("terminals"));
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
