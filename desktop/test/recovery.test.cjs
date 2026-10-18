const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const recoveryFile = path.join(__dirname, "../src/recovery.cjs");
const load = () => { assert.ok(fs.existsSync(recoveryFile), "Recovery store is not implemented"); return require(recoveryFile); };
function workspace() {
  return { version: 1, activeTab: "tab-a", tabs: [{ id: "tab-a", title: "项目 A", activePane: "pane-b", layout: {
    type: "split", direction: "horizontal", ratio: 65,
    first: { type: "pane", id: "pane-a", cwd: os.tmpdir(), shell: "bash" },
    second: { type: "pane", id: "pane-b", cwd: os.homedir(), shell: "bash" },
  } }] };
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-recovery-"));
  const alive = new Set([101, 102, 103]);
  const identities = new Map([...alive].map(id => [id, `process-${id}-original`]));
  const store = pid => new (load().RecoveryStore)(root, { pid, alive: id => alive.has(id), identity: id => identities.get(id) || null });
  return { root, alive, identities, store, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("an interrupted window restores a complete validated workspace without command replay", () => {
  const f = fixture();
  try {
    const old = f.store(101); assert.equal(old.begin(), null);
    old.save(workspace()); f.alive.delete(101);
    const next = f.store(102);
    assert.deepEqual(next.begin().workspace, workspace());
    assert.equal(next.pending, true);
    assert.equal(fs.readdirSync(path.join(f.root, "recovery")).filter(n => n.endsWith(".json")).length, 1);
    next.save(workspace()); assert.equal(next.pending, false);
    next.finishClean(); f.alive.delete(102);
    assert.equal(f.store(103).begin(), null);
  } finally { f.clean(); }
});

test("normal close clears recovery but closing an unanswered prompt preserves it", () => {
  const f = fixture();
  try {
    const old = f.store(101); old.begin(); old.save(workspace()); old.finishClean();
    assert.equal(f.store(102).begin(), null);
    const crashed = f.store(101); crashed.begin(); crashed.save(workspace()); f.alive.delete(101);
    const undecided = f.store(103); assert.ok(undecided.begin());
    undecided.finishClean(); f.alive.delete(103);
    assert.deepEqual(f.store(102).begin().workspace, workspace());
  } finally { f.clean(); }
});

test("active windows never overwrite or consume one another's checkpoints", () => {
  const f = fixture();
  try {
    const a = f.store(101), b = f.store(102); a.begin(); a.save(workspace());
    assert.equal(b.begin(), null); b.save(workspace());
    a.finishClean();
    assert.ok(fs.existsSync(b.file));
    f.alive.delete(102);
    assert.deepEqual(f.store(103).begin().workspace, workspace());
  } finally { f.clean(); }
});

test("discarding recovery starts fresh and late writes cannot resurrect a clean exit", () => {
  const f = fixture();
  try {
    const old = f.store(101); old.begin(); old.save(workspace()); f.alive.delete(101);
    const next = f.store(102); next.begin(); next.discardPending(); next.finishClean();
    next.save(workspace()); f.alive.delete(102);
    assert.equal(f.store(103).begin(), null);
  } finally { f.clean(); }
});

test("invalid topology, duplicate IDs and excessive sessions are rejected before writing", () => {
  const { validateWorkspace } = load();
  assert.deepEqual(validateWorkspace(workspace()), workspace());
  for (const mutate of [
    x => { x.activeTab = "unknown"; },
    x => { x.tabs[0].activePane = "unknown"; },
    x => { x.tabs[0].layout.second.id = "pane-a"; },
    x => { x.tabs[0].layout.ratio = 500; },
    x => { x.tabs[0].layout.first.cwd = "relative"; },
    x => { x.tabs[0].layout.direction = "diagonal"; },
    x => { x.tabs = Array.from({ length: 41 }, (_, i) => ({ id: `t-${i}`, title: "", activePane: `p-${i}`, layout: { type: "pane", id: `p-${i}`, cwd: os.tmpdir(), shell: "bash" } })); x.activeTab = "t-0"; },
  ]) {
    const x = workspace(); mutate(x); assert.throws(() => validateWorkspace(x));
  }
  const x = workspace(); x.tabs[0].layout.first.command = "do-not-run";
  assert.equal(Object.hasOwn(validateWorkspace(x).tabs[0].layout.first, "command"), false);
});

test("corrupt files are ignored and a failed save preserves the last complete snapshot", () => {
  const f = fixture();
  try {
    const a = f.store(101); a.begin(); a.save(workspace());
    fs.writeFileSync(path.join(f.root, "recovery", "broken.json"), "{broken");
    const invalid = workspace(); invalid.tabs[0].activePane = "missing";
    assert.throws(() => a.save(invalid));
    f.alive.delete(101);
    const b = f.store(102); assert.deepEqual(b.begin().workspace, workspace());
    assert.equal(process.platform === "win32" || (fs.statSync(b.file).mode & 0o077) === 0, true);
  } finally { f.clean(); }
});


test("PID reuse and a reboot do not hide an abandoned workspace behind another live process", () => {
  const f = fixture();
  try {
    const old = f.store(101); old.begin(); old.save(workspace());
    f.identities.set(101, "different-boot-and-process-start");
    const next = f.store(101);
    assert.deepEqual(next.begin().workspace, workspace());
  } finally { f.clean(); }
});

test("an interrupted atomic write leaves the previous complete recovery file untouched", () => {
  const f = fixture(), rename = fs.renameSync;
  try {
    const store = f.store(101); store.begin(); store.save(workspace());
    const previous = fs.readFileSync(store.file, "utf8");
    const changed = workspace(); changed.tabs[0].title = "新名称";
    fs.renameSync = (source, target) => {
      if (target === store.file) throw Object.assign(Error("disk write failed"), { code: "EIO" });
      return rename(source, target);
    };
    assert.throws(() => store.save(changed), /disk write failed/);
    assert.equal(fs.readFileSync(store.file, "utf8"), previous);
    assert.equal(fs.readdirSync(store.directory).some(name => name.startsWith(".recovery-")), false);
  } finally { fs.renameSync = rename; f.clean(); }
});


test("temporarily unavailable process identity never steals a live window's checkpoint", () => {
  const f = fixture();
  try {
    f.identities.delete(101);
    const a = f.store(101); a.begin(); a.save(workspace());
    f.identities.set(101, "identity-is-readable-now");
    assert.equal(f.store(102).begin(), null);
    assert.ok(fs.existsSync(a.file));
  } finally { f.clean(); }
});

test("directory sync failure after an atomic rename does not report a committed discard as failed", () => {
  const f = fixture(), sync = fs.fsyncSync;
  try {
    const old = f.store(101); old.begin(); old.save(workspace()); f.alive.delete(101);
    const next = f.store(102); next.begin();
    fs.fsyncSync = fd => {
      if (fs.fstatSync(fd).isDirectory()) throw Object.assign(Error("directory sync unavailable"), { code: "EIO" });
      return sync(fd);
    };
    assert.doesNotThrow(() => next.discardPending());
    assert.equal(next.pending, false);
    assert.equal(next.workspace, null);
    assert.equal(JSON.parse(fs.readFileSync(next.file, "utf8")).workspace, null);
  } finally { fs.fsyncSync = sync; f.clean(); }
});
