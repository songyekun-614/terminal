"use strict";
const { execFileSync } = require("node:child_process");

function readGnomeProxy() {
  return execFileSync("gsettings", ["list-recursively", "org.gnome.system.proxy"], {
    encoding: "utf8",
    timeout: 1000,
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

// GSettings output is data, never shell input or JavaScript to evaluate.
function proxyEnvironment(environment = process.env, read = readGnomeProxy, platform = process.platform) {
  const env = { ...environment };
  if (platform !== "linux") return env;
  const inherit = (name, fallback) => {
    const upper = name.toUpperCase();
    const value = env[name] ?? env[upper] ?? fallback;
    if (value !== undefined) {
      env[name] ??= value;
      env[upper] ??= value;
    }
  };
  for (const name of ["http_proxy", "https_proxy", "all_proxy", "no_proxy"]) inherit(name);
  // An explicit ALL_PROXY is the user's fallback, including an empty opt-out.
  if (env.all_proxy !== undefined) return env;
  try {
    const values = {};
    for (const line of read().split("\n")) {
      const match = line.match(/^org\.gnome\.system\.proxy(\.[a-z]+)?\s+(\S+)\s+(.+)$/);
      if (match) values[(match[1] || "") + "." + match[2]] = match[3].trim();
    }
    const string = (key) => {
      const raw = values[key] || "";
      return /^(['"])[^'"\\]*\1$/.test(raw) ? raw.slice(1, -1) : "";
    };
    if (string(".mode") !== "manual") return env;
    const endpoint = (name, scheme = "http") => {
      const host = string(`.${name}.host`);
      const port = Number(values[`.${name}.port`]);
      if (!/^[a-zA-Z0-9._:\[\]-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
      const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
      try { new URL(`${scheme}://${address}:${port}`); } catch { return undefined; }
      return `${scheme}://${address}:${port}`;
    };
    // Do not copy desktop passwords into shell environments.
    const http = values[".http.use-authentication"] === "true" ? undefined : endpoint("http");
    const https = endpoint("https") || http;
    const socks = endpoint("socks", "socks5h");
    inherit("http_proxy", http);
    inherit("https_proxy", https);
    inherit("all_proxy", socks);
    if (http || https || socks) {
      const bypass = [...(values[".ignore-hosts"] || "").matchAll(/['"]([^'"\\]*)['"]/g)]
        .map((match) => match[1].replace(/^\*\./, "."))
        .filter((host) => /^[a-zA-Z0-9._:/\[\]-]+$/.test(host));
      inherit("no_proxy", bypass.join(","));
    }
  } catch {
    // Missing GNOME schemas/tools or an unavailable settings backend must not block a tab.
  }
  return env;
}
module.exports = { proxyEnvironment };
