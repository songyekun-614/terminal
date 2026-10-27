const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(__dirname, "../src/escape.cjs");
function action(event, overlays) {
  assert.ok(fs.existsSync(file), "Escape overlay routing is missing");
  return require(file).escapeAction(event, overlays);
}

test("Escape reaches CLI input when no application overlay is open", () => {
  assert.equal(action({ key: "Escape" }), null);
  assert.equal(action({ key: "Escape", repeat: true }), null);
  assert.equal(action({ key: "Escape" }, { busy: true }), null);
});

test("Escape dismisses dialog, menu and search in priority order", () => {
  const event = { key: "Escape" };
  assert.equal(action(event, { dialog: true, menu: true, search: true }), "dialog");
  assert.equal(action(event, { menu: true, search: true }), "menu");
  assert.equal(action(event, { search: true }), "search");
  assert.equal(action(event, { dialog: false, menu: false, search: false }), null);
});

test("modified Escape and input-method keys are not application cancellation", () => {
  for (const extra of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }])
    assert.equal(action({ key: "Escape", ...extra }, { dialog: true }), null);
  assert.equal(action({ key: "Enter" }, { dialog: true }), null);
});
