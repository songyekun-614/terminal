export const profiles = {
  Pro: { background: "#17191e", foreground: "#f2f2f4", cursor: "#d2d4da" },
  Basic: { background: "#faf9f7", foreground: "#242528", cursor: "#27282a" },
  Homebrew: { background: "#101814", foreground: "#b9f1cb", cursor: "#8ce2aa" },
};
export const presets = {
  石墨灰: "#17191e",
  午夜蓝: "#121e32",
  森林绿: "#13251c",
  暖棕: "#2b211e",
  酒红: "#2d1b24",
  深青: "#10282a",
  暖白: "#faf9f7",
  浅灰: "#eceff3",
  浅蓝: "#e7f0fa",
  淡绿: "#e8f2eb",
};
export function color(value) {
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value || "")) return null;
  return value.length === 4
    ? "#" + [...value.slice(1)].map((c) => c + c).join("")
    : value.toLowerCase();
}
function luminance(c) {
  return [1, 3, 5]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
export function palette(settings) {
  const p = { ...(profiles[settings.profile] || profiles.Pro) };
  const bg = color(settings.background);
  if (bg) {
    p.background = bg;
    const ratio = (c) =>
      (Math.max(luminance(bg), luminance(c)) + 0.05) /
      (Math.min(luminance(bg), luminance(c)) + 0.05);
    if (ratio(p.foreground) < 4.5)
      p.foreground = ["#242528", "#f2f2f4", "#000000", "#ffffff"].sort(
        (a, b) => ratio(b) - ratio(a),
      )[0];
    p.cursor = p.foreground;
  }
  return p;
}
