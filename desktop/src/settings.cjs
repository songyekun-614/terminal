"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeShortcuts, validateShortcuts } = require("./shortcuts.cjs");
const PROFILES = {
  Pro: { background: "#17191e", foreground: "#f2f2f4", cursor: "#d2d4da" },
  Basic: { background: "#faf9f7", foreground: "#242528", cursor: "#27282a" },
  Homebrew: { background: "#101814", foreground: "#b9f1cb", cursor: "#8ce2aa" },
};
function color(value) {
  if (typeof value !== "string") return null;
  value = value.trim().toLowerCase();
  if (/^#[\da-f]{3}$/.test(value))
    value = "#" + [...value.slice(1)].map((c) => c + c).join("");
  return /^#[\da-f]{6}$/.test(value) ? value : null;
}
function normalizeSettings(value) {
  const v =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    profile: Object.hasOwn(PROFILES, v.profile) ? v.profile : "Pro",
    shortcuts: normalizeShortcuts(v.shortcuts),
    font_family:
      typeof v.font_family === "string" &&
      v.font_family.trim() &&
      v.font_family.length <= 100
        ? v.font_family.trim()
        : "Monospace",
    font_size:
      Number.isInteger(v.font_size) && v.font_size >= 8 && v.font_size <= 32
        ? v.font_size
        : 12,
    background: color(v.background),
    wallpaper:
      typeof v.wallpaper === "string" &&
      v.wallpaper.length <= 4096 &&
      path.isAbsolute(v.wallpaper)
        ? v.wallpaper
        : null,
    wallpaper_opacity:
      typeof v.wallpaper_opacity === "number" &&
      Number.isFinite(v.wallpaper_opacity) &&
      v.wallpaper_opacity >= 0 &&
      v.wallpaper_opacity <= 1
        ? v.wallpaper_opacity
        : 0.35,
    username_color: color(v.username_color) || "#28c840",
    shell:
      typeof v.shell === "string" && /^[a-z\d_-]{1,40}$/i.test(v.shell)
        ? v.shell
        : "",
  };
}
function readSettings(root) {
  try {
    return normalizeSettings(
      JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8")),
    );
  } catch {
    return normalizeSettings({});
  }
}
function saveSettings(root, value) {
  if (value && Object.hasOwn(value, "shortcuts")) validateShortcuts(value.shortcuts);
  const s = normalizeSettings(value);
  fs.mkdirSync(root, { recursive: true });
  const temp = path.join(root, `.settings-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(temp, JSON.stringify(s, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temp, path.join(root, "settings.json"));
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
  return s;
}
function luminance(c) {
  return [1, 3, 5]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function palette(s) {
  const p = { ...PROFILES[s.profile] };
  if (s.background) {
    p.background = s.background;
    const l = luminance(p.background),
      ratio = (c) =>
        (Math.max(l, luminance(c)) + 0.05) / (Math.min(l, luminance(c)) + 0.05);
    if (ratio(p.foreground) < 4.5)
      p.foreground = ["#242528", "#f2f2f4"].sort(
        (a, b) => ratio(b) - ratio(a),
      )[0];
    if (ratio(p.foreground) < 4.5)
      p.foreground = ["#000000", "#ffffff"].sort(
        (a, b) => ratio(b) - ratio(a),
      )[0];
    p.cursor = p.foreground;
  }
  return p;
}
function ownedWallpaper(root, file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) return false;
  const relative = path.relative(path.join(root, "wallpapers"), file);
  return (
    !!relative &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}
module.exports = {
  normalizeSettings,
  readSettings,
  saveSettings,
  palette,
  color,
  ownedWallpaper,
};
