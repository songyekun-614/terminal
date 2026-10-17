# Terminal delivery and everyday features

The user authorized completing the six gaps identified after PR #3: release the existing fix, configurable Escape, current verification documentation, installer/upgrade validation, everyday features, and wider platform coverage. They explicitly have no signing certificates or additional physical machines; complete code and CI and clearly list physical validation still outstanding. Existing push, PR, merge and release authorization continues for this delivery.

## Delivery sequence

1. Release existing tested behavior as 0.2.2, refreshing installation versions and verification evidence without pretending to have signed packages.
2. Add keyboard configuration, split panes, optional workspace recovery, SSH profiles and update support; release these as 0.3.0 after native CI and review.

## Interaction and architecture

Preserve Electron/xterm/node-pty and the current visual identity. Use small CommonJS services for main-process settings/workspace/SSH/update policy and small renderer modules for keyboard/layout state. Keep renderer sandboxed with a narrow validated IPC interface.

Keyboard: settings expose Escape modes `close` (existing behavior/default for migration), `terminal` (pass to shell when no overlay), and `ctrl-shift-escape`. Overlay Escape always dismisses the top overlay. Persist editable accelerators for new/close/rename tab, search, settings, split horizontal/vertical, next pane; reject duplicate/invalid bindings and support restoring defaults. Native editable fields retain their clipboard shortcuts. Modified shortcuts must not also reach the PTY.

Workspace: a tab contains one or more terminal panes in a binary split tree (`{direction:'horizontal'|'vertical', children:[tree,tree]}` or `{pane:id}`). Existing one-pane tabs preserve their IDs/classes where possible to keep tests meaningful. Each pane has its own real PTY, focus, cwd and output. Switching tabs hides the entire split tree. Closing a pane releases its PTY and collapses its split; closing a tab checks every busy pane. New tabs inherit the active pane's local cwd. Save versioned metadata to `workspace.json` atomically: tab names/order, split tree, local pane cwd/shell and active tab/pane. Restore is opt-in and recreates only local shells; never save input/output/passwords or execute saved commands, and never automatically reconnect SSH. Bad snapshots fall back to one fresh local tab. Debounce writes and flush accepted snapshot on close without saving an empty transient layout on renderer reload.

SSH: system OpenSSH runs as a genuine PTY session; no new password storage or custom crypto. Profiles contain id/name/host/port/user/identityFile only, validated and persisted atomically in the app configuration. Build argv without shell interpolation, reject hosts beginning with `-`, invalid ports and control characters, and use strict host-key checking with the standard interactive first-connect prompt (no disabling host verification). Host/user may be selected in a Chinese-labelled dialog; keys/passwords/passphrases are handled interactively by OpenSSH. Remote sessions remain busy until exit and don't overwrite local cwd via OSC. Missing client produces an actionable UI error. Test argv plus a local SSH fixture when available; external host credentials aren't required.

Updates: use electron-updater and GitHub release metadata for supported packaged builds. Check at startup only if enabled and expose explicit check/download/install actions with progress/errors. Never auto-install while sessions are busy: ask before quitting via the existing close policy, and install only with explicit user action. In source/test builds, unsigned macOS, or unsupported package type, return a clear unsupported/manual-update state and a fixed official Releases link. Do not claim unsigned macOS auto-install works; it requires a Developer ID signature. Publish update metadata and blockmaps without architecture filename collisions; keep existing installed-user settings. Do not embed tokens or generate/sign with invented certificates. Unit tests inject the updater boundary; real release metadata/config is checked separately.

## Platforms and delivery validation

Retain Windows/Linux x64/ARM64 and add native macOS x64 (`macos-15-intel`) and ARM64 (`macos-14`) builds, real PTY/GUI tests, .app regression, DMG/zip. Handle default zsh on macOS deliberately (idle tracking must work; prefer integrated Bash for tests if necessary without claiming unsupported integration). Offer CI signing/notarization only when configured secrets exist; unsigned output is accurately labelled and remains usable for developer verification.

Validate deb/rpm package payload/dependencies and install, upgrade, uninstall/config preservation in disposable containers where practical; Windows NSIS install/upgrade/uninstall in native CI and macOS DMG mounting/bundle checks. GUI smoke of unpacked programs does not count as installation testing. Fedora/openSUSE/Arch container coverage must be labelled package/CLI validation, not physical desktop validation. Add a reproducible manual checklist for Windows 10 and real distro desktops. No fabricated evidence.

## Acceptance and constraints

Node >=22.12.0. Keep dependency versions pinned and lockfile committed. Existing GTK source is preserved. Chinese UI controls have labels, keyboard focus, native dialogs and error feedback. Existing test coverage remains, adapted only for intentional optional features. Each feature has meaningful behavior tests and red/green evidence. CI includes native GUI and packaged regression for all six platform/arch combinations; release checks assets/checksums and update metadata. Publish 0.2.2 first and 0.3.0 after all feasible code and CI gates pass. Remaining certificate/physical-machine tasks are explicitly documented with no false completion claims.
