"use strict";
// An application overlay may consume Escape; otherwise leave it to the CLI.
function escapeAction(event, { dialog = false, menu = false, search = false } = {}) {
  if (event.key !== "Escape" || event.ctrlKey || event.altKey || event.metaKey ||
      event.shiftKey || event.isComposing || event.keyCode === 229) return null;
  return dialog ? "dialog" : menu ? "menu" : search ? "search" : null;
}
module.exports = { escapeAction };
