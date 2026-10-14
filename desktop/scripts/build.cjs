"use strict";
const path = require("node:path");
const fs = require("node:fs/promises");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
async function build() {
  await esbuild.build({
    entryPoints: [path.join(root, "renderer/app.js")],
    outfile: path.join(root, "renderer/app.bundle.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome150",
    sourcemap: false,
    logLevel: "info",
  });
  await fs.copyFile(
    path.join(root, "node_modules/@xterm/xterm/css/xterm.css"),
    path.join(root, "renderer/xterm.css"),
  );
}
build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
