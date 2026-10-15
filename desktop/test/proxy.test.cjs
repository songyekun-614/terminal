const { test } = require("node:test");
const assert = require("node:assert/strict");
const { proxyEnvironment } = require("../src/proxy.cjs");
const cases = require("../../tests/proxy-cases.json");
for (const fixture of cases) {
  test(fixture.name, () => {
    const original = { ...fixture.env };
    assert.deepEqual(proxyEnvironment(original, () => fixture.settings, "linux"), fixture.want);
    assert.deepEqual(original, fixture.env);
  });
}
test("missing or timed out gsettings does not prevent shell startup", () => {
  assert.deepEqual(proxyEnvironment({ PATH: "/bin" }, () => { throw Error("unavailable"); }, "linux"), { PATH: "/bin" });
});
test("other platforms retain their existing environment", () => {
  assert.deepEqual(proxyEnvironment({ HTTPS_PROXY: "http://custom:3128" }, () => { throw Error("must not query GNOME"); }, "win32"), { HTTPS_PROXY: "http://custom:3128" });
});
