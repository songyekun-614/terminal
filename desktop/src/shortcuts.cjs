"use strict";
// Shared by the settings service and the renderer; no platform or DOM dependencies.
const commands = [
  ["new_tab", "新建标签页", "标签页", "Ctrl+Shift+T"],
  ["close_tab", "关闭标签页", "标签页", "Ctrl+Shift+W"],
  ["rename_tab", "重命名标签页", "标签页", "Ctrl+Shift+R"],
  ["previous_tab", "上一个标签页", "标签页", "Ctrl+PageUp"],
  ["next_tab", "下一个标签页", "标签页", "Ctrl+PageDown"],
  ["split_horizontal", "左右分屏", "分屏", "Ctrl+Shift+H"],
  ["split_vertical", "上下分屏", "分屏", "Ctrl+Shift+J"],
  ["next_pane", "切换面板", "分屏", "Ctrl+Shift+O"],
  ["close_pane", "关闭当前面板", "分屏", "Ctrl+Shift+X"],
  ["copy", "复制", "编辑与搜索", "Ctrl+Shift+C"],
  ["paste", "粘贴", "编辑与搜索", "Ctrl+Shift+V"],
  ["select_all", "全选", "编辑与搜索", ""],
  ["search", "搜索当前面板", "编辑与搜索", "Ctrl+Shift+F"],
  ["zoom_in", "放大字号", "显示与设置", "Ctrl+="],
  ["zoom_out", "缩小字号", "显示与设置", "Ctrl+-"],
  ["zoom_reset", "重置字号", "显示与设置", "Ctrl+0"],
  ["settings", "外观设置", "显示与设置", "Ctrl+,"],
  ["shortcuts", "快捷键设置", "显示与设置", ""],
  ["escape_close", "关闭面板或退出", "显示与设置", ""],
].map(([id, label, group, binding]) => Object.freeze({ id, label, group, binding }));
const defaults = Object.freeze(Object.fromEntries(commands.map(c => [c.id, c.binding])));
const modifierNames = ["Ctrl", "Alt", "Shift", "Meta"];
const namedKeys = ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Backspace", "Insert", "Space", "Tab", "Enter", "Escape"];
const reserved = new Set(["Ctrl+C", "Ctrl+V", "Alt+F4", "Alt+Tab", "Alt+Shift+Tab", "Alt+Escape", "Ctrl+Alt+Delete", "Ctrl+Alt+Backspace", "Meta+L", "Meta+Tab", "Meta+Shift+Tab", "Meta+Space"]);
function normalizeChord(value) {
  if (typeof value !== "string" || value.length > 80) throw Error("快捷键格式无效");
  if (!value.trim()) return "";
  const parts = value.trim().replace(/\+\+$/, "+Plus").split("+").map(p => p.trim());
  const rawKey = parts.pop();
  const modifiers = parts.map(p => modifierNames.find(m => m.toLowerCase() === p.toLowerCase()));
  if (modifiers.some(m => !m) || new Set(modifiers).size !== modifiers.length) throw Error("快捷键修饰键无效");
  let key = namedKeys.find(k => k.toLowerCase() === rawKey.toLowerCase()) || rawKey.toUpperCase();
  if (key === "ESC") key = "Escape";
  if (key === "PLUS") key = "=";
  if (!(/^[A-Z0-9,.;'`\/[\]\\=\-]$/.test(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key) || namedKeys.includes(key))) throw Error("请选择字母、数字、功能键或常用控制键");
  if (!modifiers.some(m => m !== "Shift") && !/^F\d+$/.test(key) && key !== "Escape") throw Error("请同时按 Ctrl、Alt 或 Meta，避免占用终端输入");
  const chord = [...modifierNames.filter(m => modifiers.includes(m)), key].join("+");
  if (reserved.has(chord)) throw Error("此组合由系统或终端保留，请选择其他快捷键");
  return chord;
}
function bindingsFor(id, chord) {
  return id === "zoom_in" && chord === "Ctrl+=" ? [chord, "Ctrl+Shift+="] : [chord];
}
function validateShortcuts(value) {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw Error("快捷键配置无效");
  const result = {}, used = new Map();
  for (const command of commands) {
    let chord;
    try {
      chord = normalizeChord(value && Object.hasOwn(value, command.id) ? value[command.id] : command.binding);
      if (chord.endsWith("Escape")) throw Error("Esc 保留给终端程序和弹窗取消，请选择其他快捷键");
    } catch (err) {
      err.action = command.id;
      err.message = `${command.label}：${err.message}`;
      throw err;
    }
    result[command.id] = chord;
    if (!chord) continue;
    for (const binding of bindingsFor(command.id, chord)) {
      if (used.has(binding)) {
        const other = used.get(binding);
        const err = Error(`快捷键冲突：${command.label}与${other.label}均使用 ${binding}`);
        err.action = command.id;
        err.conflicts = [command.id, other.id];
        throw err;
      }
      used.set(binding, command);
    }
  }
  return result;
}
function normalizeShortcuts(value) {
  try {
    // Older releases bound plain Escape to closing a pane/window. Migrate only
    // that binding so CLI cancellation works without resetting custom shortcuts.
    if (value && Object.hasOwn(value, "escape_close") && normalizeChord(value.escape_close) === "Escape")
      value = { ...value, escape_close: "" };
    return validateShortcuts(value);
  }
  catch { return { ...defaults }; }
}
function shortcutFromEvent(event) {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState?.("AltGraph")) return null;
  if (!event.key || ["Control", "Alt", "Shift", "Meta", "AltGraph", "Dead", "Process", "Unidentified"].includes(event.key)) return null;
  let key = event.key;
  if (key === " ") key = "Space";
  // Shift changes punctuation, but remains a modifier in the stored chord.
  const shifted = { "+": "=", "<": ",", ">": ".", "_": "-", ":": ";", '"': "'", "?": "/", "{": "[", "}": "]", "|": "\\", "~": "`" };
  if (shifted[key]) key = shifted[key];
  if (event.shiftKey && /^Digit[0-9]$/.test(event.code || "") && /[!@#$%^&*()]/.test(key)) key = event.code.slice(-1);
  if (key.length === 1) key = key.toUpperCase();
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta", key].filter(Boolean).join("+");
}
function actionForEvent(event, shortcuts = defaults) {
  const chord = shortcutFromEvent(event);
  if (!chord) return null;
  for (const command of commands) {
    const binding = shortcuts[command.id];
    if (binding && bindingsFor(command.id, binding).includes(chord)) return command.id;
  }
  return null;
}
module.exports = { commands, defaults, normalizeChord, validateShortcuts, normalizeShortcuts, shortcutFromEvent, actionForEvent };
