# Terminal Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Complete the six approved delivery/feature gaps, publish 0.2.2 then 0.3.0, and record unavailable signing/physical validation honestly.
**Architecture:** Preserve Electron/xterm/node-pty; add small settings, workspace, SSH and updater services behind validated IPC. Keep all new interactions in the existing Chinese desktop UI.
**Tech Stack:** Node 22+, Electron, xterm.js, node-pty, Playwright, electron-builder/updater, system OpenSSH, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-10-17-terminal-delivery-design.md`

## Global Constraints

- Node >=22.12.0; pinned dependencies and lockfile. Preserve GTK code and existing user settings.
- Chinese labelled accessible controls; renderer sandbox stays enabled; no arbitrary renderer network/Node access.
- No credentials, terminal input/output, or commands in saved workspace; SSH uses system OpenSSH/host verification.
- No automatic command replay, SSH reconnect or update install; update install requires explicit user action and busy-session confirmation.
- No signing certificates or extra physical machines available. Implement optional CI signing hooks and document unverified targets honestly.
- Work only in `/home/song/Projects/terminal-delivery`. Implementers do not push or spawn subagents. Commit changes and write a report with test commands/results and red/green evidence.

### Task 1: Release 0.2.2 and current evidence

**Files:** desktop/package.json, desktop/package-lock.json, README.md, docs/cross-platform-verification.md, .github/workflows/desktop.yml.
**Interfaces:** current tree based on main f5d695b; preserve all APIs. Produces version 0.2.2 ready for the existing four-platform release workflow.
- [ ] Change only package version/lock root version and README installation examples from 0.2.1 to 0.2.2 using a structured Node/Python script.
- [ ] Update release notes to describe Escape closing and shell-ready test fix, and prepend current four-platform PR CI evidence (run 39013606856). Keep older verification history dated.
- [ ] Run `npm test`, `npm run build`, `git diff --check`; existing full E2E tree is unchanged from reviewed PR.
- [ ] Commit `chore: prepare terminal 0.2.2 release`; controller uploads, reviews/merges with `[release]` title and monitors actual publication.

### Task 2: Configurable shortcuts and Escape

**Files:** create desktop/src/shortcuts.cjs and desktop/test/shortcuts.test.cjs; modify settings.cjs, renderer/app.js, renderer/index.html, renderer/style.css and desktop.spec.cjs.
**Interfaces:** normalized settings add `escape_mode:'close'|'terminal'|'ctrl-shift-escape'`, `keybindings:{newTab,closeTab,renameTab,search,settings,splitHorizontal,splitVertical,nextPane}` string accelerators. Export `DEFAULT_BINDINGS`, `normalizeBindings(value)` and matching helpers reusable from renderer bundling. Defaults retain current tab shortcuts; split defaults Ctrl+Shift+H, Ctrl+Shift+J, next pane Ctrl+Shift+O. Invalid/duplicate accelerators must be rejected on save with a visible field error; malformed old configuration falls back to defaults.
- [ ] Write failing Node tests for invalid values, duplicate bindings, modifier matching and stable migration, plus E2E Escape passthrough and changed new-tab shortcut; run focused tests to record RED.
- [ ] Implement settings normalization and a keyboard settings section in the existing modal. Preserve overlay Escape cancel regardless of configured terminal mode; Ctrl+Shift+Escape closes only in that mode. Stop matched app accelerators before xterm; editable text clipboard behavior remains native.
- [ ] Add reset-defaults action; settings cancel restores keybindings with appearance preview. Leave split handlers as dispatch hooks if task 3 not present yet, not visible broken buttons.
- [ ] Run `npm test`, build and full E2E; commit and report.

### Task 3: Split panes and workspace recovery

**Files:** create desktop/src/workspace.cjs, desktop/renderer/workspace.js, desktop/test/workspace.test.cjs; modify sessions.cjs, main.cjs, preload.cjs, renderer/app.js/index.html/style.css, settings.cjs, desktop.spec.cjs.
**Interfaces:** snapshots are `{version:1,tabs:[{id,title,tree,panes:[{id,cwd,shell}]}],activeTab,activePane}`. Validate depth <=8, <=40 total panes, absolute existing local directories and installed shells; atomic bounded JSON in config. Main IPC `loadWorkspace()`, `saveWorkspace(snapshot)`; settings add `restore_workspace:boolean` default false. Renderer implements split tree and invokes task 2 shortcut action hooks. UI tests can identify `.terminal-pane.active` as the focused pane while all panes in active tab remain visible.
- [ ] Write failing service tests for snapshot normalization, corrupt/missing files, bounds, atomic persistence and no command persistence. Write E2E for two independent split PTYs, collapse on close and local cwd/title/order recovery across app restart.
- [ ] Implement tab-versus-pane state with minimum layout changes; split tree, visible pane focus borders, labelled split/close-pane controls. Fit all visible panes on container resize. Keep tab drag/rename and clipboard/input isolation.
- [ ] Add safe opt-in recovery; record latest dirs on shell OSC; debounce metadata writes and ensure graceful close persists the last accepted layout. Exclude SSH panes from auto-reconnect in future task 4. Close tab checks all busy panes once; release PTYs once and preserve busy-window confirmation.
- [ ] Run full services/build/E2E, including restart test; commit and report.

### Task 4: SSH profiles and real OpenSSH terminals

**Files:** create desktop/src/ssh.cjs and desktop/test/ssh.test.cjs; modify sessions.cjs, main.cjs, preload.cjs, renderer/app.js/index.html/style.css, workspace service as needed, desktop.spec.cjs.
**Interfaces:** service exports `normalizeProfile(value)`, `sshCommand(profile, clientPath)` returning `{file,args}`, atomic profile CRUD. Profile `{id,name,host,port,user,identityFile}`; never passwords. IPC list/save/delete profiles and createSession({sshProfileId}); returned session metadata includes `kind:'ssh'|'local'`. Remote OSC must not alter local cwd or idle status.
- [ ] RED tests for leading-option/control-character hosts/users, invalid port, argv paths with spaces, duplicate profile IDs and password omission. Add real local OpenSSH integration fixture if available; otherwise CI can provision a disposable local server with an ephemeral key.
- [ ] Add Chinese SSH connect/manage dialog, key file chooser and missing-client error. Use node-pty spawning system ssh directly with argument arrays and normal host verification; preserve interactive auth, output, resize and close.
- [ ] Ensure remote sessions always busy until exit, local new tab from SSH falls back to local home, snapshots never reconnect SSH, profile deletion does not kill active connections.
- [ ] Run services/build/E2E and SSH fixture evidence; commit and report.

### Task 5: Update checking, download and explicit installation

**Files:** create desktop/src/updates.cjs, desktop/test/updates.test.cjs; modify package files, main.cjs/preload.cjs, renderer/app.js/index.html, electron-builder.yml, workflow as needed.
**Interfaces:** pinned electron-updater compatible with builder 26.15.3; IPC check/download/install and update-state events; bootstrap version and support state. Settings add `check_updates:boolean` default true. Main controller accepts injected updater to test policy. Renderer checks fixed provider only via IPC. Metadata uses architecture-specific channels to prevent x64/ARM64 collision on release merge.
- [ ] Inspect installed/version-specific official electron-builder/updater APIs before implementation. Write RED tests for not-packaged/unsupported/unsigned-mac states, newer/no-update/error progress, download gating and busy install cancellation.
- [ ] Add automatic noninstalling checks and menu check/update UI with progress, error recovery and fixed official releases link. Set updater autoDownload false and autoInstallOnAppQuit false. Install only after explicit UI action, successful download and the main-process busy-close policy; avoid restart-with-unclosed PTYs.
- [ ] Configure real GitHub update provider and generation/upload of metadata/blockmaps. Unsigned macOS reports manual updates until credentials exist. Do not introduce embedded tokens, disable TLS or pretend an unsigned package was signed.
- [ ] Run Node tests/build and meaningful E2E of UI boundary; commit and report version-specific limitations.

### Task 6: macOS and installer lifecycle CI

**Files:** electron-builder.yml, package scripts, .github/workflows/desktop.yml plus new packaging-test scripts/workflow; shell/main fixes only where needed; docs/platform-validation.md.
**Interfaces:** macOS x64 runner macos-15-intel and ARM64 macos-14; `dist:mac`; .app packaged test executable path `terminal.app/Contents/MacOS/terminal`. Artifacts dmg/zip, architecture-distinct metadata. Signing keys only via configured secrets; existing unsigned builds continue with accurate labels. Release expects six platforms for 0.3.0.
- [ ] Inspect official platform docs and add native macOS build/service/GUI/packaged tests. Ensure Bash/zsh selection and busy markers work; tests must wait for real ready signal.
- [ ] Implement disposable installer lifecycle tests: deb/rpm install + upgrade + uninstall/config retention (containers can test CLI/payload only); Windows NSIS silent install to temp user directory, upgrade preserving sentinel settings, launch/close smoke then uninstall preserving config; macOS mount/read dmg and verify app bundle/launch. All scripts fail on actual incorrect paths and avoid user/system destructive operations.
- [ ] Add Fedora/openSUSE/Arch package/CLI/container jobs where feasible with explicit labels; never call these physical desktop tests. Add CI optional signing/notarization environment hooks without exposing secrets or claiming signing occurred. No real certificate purchases.
- [ ] Run locally feasible config/script checks; report exact CI-only/physical targets. Commit and report.

### Task 7: Integrated verification, documentation and 0.3.0 release

**Files:** package versions/lock, README.md, docs/cross-platform.md, verification/platform docs, workflow release notes; focused code fixes only for verified integration defects.
**Interfaces:** combine tasks 2–6 without changing their contracts; package version 0.3.0 and release notes describe only delivered behavior. Settings migration from 0.2.1/0.2.2 retains appearance and defaults.
- [ ] Update all current instructions/screens/keyboard descriptions for split, restore, SSH, updates and six platform targets, keeping historical records dated. Include unsigned Mac Gatekeeper handling accurately and no blanket bypass advice. Mark Windows 10 and Fedora/Arch/openSUSE GUI physical verification outstanding.
- [ ] Run `npm test`, `npm run build`, source E2E, local pack and packaged E2E. Review migration and max-40 PTY cap with SSH/splits. Verify no secret/password appears in workspace/profile snapshots.
- [ ] Commit reviewable final changes. Controller uploads branch through GitHub tools, verifies remote tree equality, creates PR, obtains final review, waits native and installer CI, fixes failures, merges and publishes 0.3.0 with checksums/metadata; confirm actual Release assets rather than only main merge.
