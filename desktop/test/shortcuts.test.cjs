const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  defaults, normalizeShortcuts, validateShortcuts, shortcutFromEvent, actionForEvent,
} = require("../src/shortcuts.cjs");
const { readSettings, saveSettings } = require("../src/settings.cjs");

// Remapping must replace the old chord, survive restart, and keep terminal input usable.
test("custom shortcuts persist alongside appearance and disabled bindings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-shortcuts-"));
  try {
    const saved = saveSettings(root, { font_size: 17, shortcuts: { new_tab: "alt+shift+n", escape_close: "" } });
    assert.equal(saved.shortcuts.new_tab, "Alt+Shift+N");
    assert.equal(readSettings(root).shortcuts.escape_close, "");
    assert.equal(readSettings(root).font_size, 17);
    assert.equal(readSettings(root).shortcuts.split_horizontal, "Ctrl+Shift+H");
    const original = fs.readFileSync(path.join(root, "settings.json"), "utf8");
    assert.throws(() => saveSettings(root, { shortcuts: { new_tab: defaults.close_tab } }), /冲突/);
    assert.equal(fs.readFileSync(path.join(root, "settings.json"), "utf8"), original);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("invalid and conflicting stored shortcuts recover to usable defaults", () => {
  assert.deepEqual(normalizeShortcuts(null), defaults);
  assert.deepEqual(normalizeShortcuts({ new_tab: "N" }), defaults);
  assert.deepEqual(normalizeShortcuts({ new_tab: "Ctrl+Shift+W" }), defaults);
  assert.deepEqual(normalizeShortcuts({ new_tab: 42 }), defaults);
  assert.equal(normalizeShortcuts({ escape_close: "" }).escape_close, "");
  assert.equal(normalizeShortcuts({ new_tab: "F6" }).new_tab, "F6");
});

test("validation rejects typing, clipboard and system conflicts and aliases", () => {
  for (const value of ["A", "Shift+A", "Enter", "Ctrl", "Ctrl+A+B", "Ctrl+V", "Alt+F4", "Meta+L", "Ctrl+Alt+Delete"]) {
    assert.throws(() => validateShortcuts({ new_tab: value }), undefined, value);
  }
  assert.throws(() => validateShortcuts({ new_tab: "Escape" }), /Esc/);
  assert.throws(() => validateShortcuts({ new_tab: "Ctrl+Shift+=" }), /冲突/);
  const swapped = validateShortcuts({ new_tab: defaults.close_tab, close_tab: defaults.new_tab });
  assert.equal(swapped.new_tab, defaults.close_tab);
});

function key(key, modifiers = {}) {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers };
}
test("default and reset shortcuts leave Escape available to CLI applications", () => {
  for (const shortcuts of [defaults, validateShortcuts(), normalizeShortcuts(null)]) {
    assert.equal(actionForEvent(key("Escape"), shortcuts), null);
    assert.equal(actionForEvent(key("W", { ctrlKey: true, shiftKey: true }), shortcuts), "close_tab");
    assert.equal(actionForEvent(key("X", { ctrlKey: true, shiftKey: true }), shortcuts), "close_pane");
  }
});

test("loading legacy Escape settings releases Escape without losing other preferences", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-escape-migration-"));
  try {
    for (const binding of ["Escape", "esc", " escape "]) {
      fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({
        font_size: 19,
        shell: "bash",
        shortcuts: { new_tab: "Alt+Shift+N", escape_close: binding },
      }));
      const loaded = readSettings(root);
      assert.equal(actionForEvent(key("Escape"), loaded.shortcuts), null);
      assert.equal(actionForEvent(key("N", { altKey: true, shiftKey: true }), loaded.shortcuts), "new_tab");
      assert.equal(loaded.font_size, 19);
      assert.equal(loaded.shell, "bash");
      saveSettings(root, loaded);
      assert.equal(readSettings(root).shortcuts.escape_close, "");
    }
    assert.equal(normalizeShortcuts({ escape_close: "F6" }).escape_close, "F6");
    assert.equal(actionForEvent(key("F6"), normalizeShortcuts({ escape_close: "F6" })), "escape_close");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("saving shortcuts cannot reassign Escape away from CLI applications", () => {
  assert.throws(() => validateShortcuts({ escape_close: "Escape" }), /Esc/);
  assert.throws(() => validateShortcuts({ close_tab: "Escape" }), /Esc/);
});

test("event matching is exact, ignores composition and AltGraph, and releases old bindings", () => {
  const custom = validateShortcuts({ new_tab: "Alt+Shift+N", escape_close: "" });
  assert.equal(actionForEvent(key("N", { altKey: true, shiftKey: true }), custom), "new_tab");
  assert.equal(actionForEvent(key("T", { ctrlKey: true, shiftKey: true }), custom), null);
  assert.equal(actionForEvent(key("N", { ctrlKey: true, altKey: true, shiftKey: true }), custom), null);
  assert.equal(actionForEvent(key("Escape"), custom), null);
  assert.equal(shortcutFromEvent(key("n", { ctrlKey: true, isComposing: true })), null);
  assert.equal(shortcutFromEvent(key("n", { ctrlKey: true, altKey: true, getModifierState: name => name === "AltGraph" })), null);
  assert.equal(shortcutFromEvent(key("Process", { keyCode: 229 })), null);
  assert.equal(actionForEvent(key("+", { ctrlKey: true, shiftKey: true }), defaults), "zoom_in");
  assert.equal(actionForEvent(key("=", { ctrlKey: true }), defaults), "zoom_in");
  assert.equal(shortcutFromEvent(key("<", { code: "Comma", ctrlKey: true, shiftKey: true })), "Ctrl+Shift+,");
  assert.equal(shortcutFromEvent(key("!", { code: "Digit1", ctrlKey: true, shiftKey: true })), "Ctrl+Shift+1");
});
