const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const appearance = import("data:text/javascript;base64," + fs.readFileSync(path.join(__dirname, "../renderer/appearance.js")).toString("base64"));

function luminance(hex) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("terminal selections remain readable on every profile, preset and custom background", async () => {
  const { profiles, presets, palette } = await appearance;
  const backgrounds = [undefined, ...Object.values(presets), "#000", "#fff", "#777", "#aaa", "#ff0", "#f0f", "#0ff", "#00f", "#f00"];
  for (const profile of Object.keys(profiles)) {
    for (const background of backgrounds) {
      const theme = palette({ profile, background });
      const context = `${profile} on ${background || "default"}`;
      for (const key of ["selectionBackground", "selectionInactiveBackground", "selectionForeground"])
        assert.match(theme[key] || "", /^#[\da-f]{6}$/i, `${context}: explicit ${key}`);
      assert.ok(contrast(theme.selectionForeground, theme.selectionBackground) >= 4.5, `${context}: active selected text`);
      assert.ok(contrast(theme.selectionForeground, theme.selectionInactiveBackground) >= 4.5, `${context}: inactive selected text`);
      assert.ok(contrast(theme.selectionBackground, theme.background) >= 2, `${context}: selection stands out`);
      assert.notEqual(theme.selectionBackground, theme.selectionInactiveBackground, `${context}: focus remains visible`);
    }
  }
});
