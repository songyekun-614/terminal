"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const call =
  (name) =>
  (...args) =>
    ipcRenderer.invoke("terminal:" + name, ...args);
const listen = (name) => (callback) => {
  if (typeof callback !== "function") throw new TypeError("Callback required");
  const handler = (_, value) => callback(value);
  ipcRenderer.on("terminal:" + name, handler);
  return () => ipcRenderer.removeListener("terminal:" + name, handler);
};
contextBridge.exposeInMainWorld(
  "terminalAPI",
  Object.freeze({
    bootstrap: call("bootstrap"),
    createSession: call("createSession"),
    write: call("write"),
    resize: call("resize"),
    ack: call("ack"),
    closeSession: call("closeSession"),
    sessionInfo: call("sessionInfo"),
    saveSettings: call("saveSettings"),
    saveShortcuts: call("saveShortcuts"),
    saveWorkspace: call("saveWorkspace"),
    getRecovery: call("getRecovery"),
    discardRecovery: call("discardRecovery"),
    importWallpaper: call("importWallpaper"),
    discardWallpapers: call("discardWallpapers"),
    wallpaper: call("wallpaper"),
    windowAction: call("windowAction"),
    confirmClose: call("confirmClose"),
    readClipboard: call("readClipboard"),
    writeClipboard: call("writeClipboard"),
    onOutput: listen("output"),
    onExit: listen("exit"),
  }),
);
