# Split Panes Platform Release Implementation Plan

> **For agentic workers:** Use executing-plans to execute this release in the current isolated worktree. Use checkboxes to track verification and publication.

**Goal:** Publish the completed split-pane feature as terminal 0.3.0 for the existing Windows/Linux x64/ARM64 platforms.

**Architecture:** Preserve the Electron/xterm/node-pty implementation and the existing four-runner build, source UI regression, package and packaged UI regression pipeline. Extend the resize regression to Windows ConPTY, prepare version-specific release notes, and publish only after all native checks pass.

**Tech Stack:** Node 22+, Electron 44.7.2, node-pty 1.1.0, xterm.js 6.0.0, Playwright 1.64.0, electron-builder 26.15.3, GitHub Actions.

**Spec:** Existing split behavior and user instruction to extend to other supported systems and publish; this release does not implement the broader historical delivery plan's SSH, workspace recovery, updates or macOS tasks.

## Global Constraints

- Work in `/home/song/Projects/terminal-delivery`; preserve the published 0.2.2 tag/assets.
- Windows x64/ARM64 and Linux x64/ARM64 remain the release platforms. macOS has no packages in this release.
- Retain real PTYs, renderer sandboxing, busy-close confirmation, existing appearance and settings.
- Publish 0.3.0 only after matching native service, source UI, package and packaged UI checks pass on all four runners.
- Never describe CI desktop tests as physical Windows 10/Fedora/Arch/openSUSE verification or unsigned Windows installers as signed.

### Task 1: Cross-platform resize and lifecycle regression

**Files:** `desktop/test/desktop.spec.cjs`.

- [ ] Replace the Unix-only dimension probe with platform-specific real-shell commands: `[Console]::WindowHeight`/`WindowWidth` on Windows and `stty size` on Linux. Both return `before-size:<rows> <cols>` / `after-size:<rows> <cols>` and must demonstrate reduced PTY columns after resizing.
- [ ] Keep temporary working directories under the test config root, and remove them after app shutdown with bounded filesystem retries for Windows.
- [ ] Run focused dimension and split tests, then full local services/build/UI regression. Use native CI as the evidence for Windows/ARM64.

### Task 2: Prepare 0.3.0 metadata and release notes

**Files:** `desktop/package.json`, `desktop/package-lock.json`, `.github/workflows/desktop.yml`, `README.md`, `docs/cross-platform.md`, `docs/cross-platform-verification.md`.

- [ ] Set package and lock root versions to `0.3.0`; update current install examples and feature documentation while preserving dated historical evidence.
- [ ] Describe nested split panes, directory inheritance, focus/clipboard isolation, separator resizing and close confirmation in release notes. Retain the Esc/Vim limitation and unsigned Windows/macOS status.
- [ ] Preserve the requirement for exactly 10 platform installers plus SHA256SUMS and the tag/source mismatch guard. Include split screenshot/documentation links.
- [ ] Review the complete diff and verify `git diff --check`.

### Task 3: Review and native platform verification

**Files:** all changed release files plus focused fixes supported by CI failures.

- [ ] Request an independent code/release review; address blockers and rerun relevant regression.
- [ ] Upload exact local Git tree through the connected GitHub tools, validate the returned tree SHA, and open a `[release]` PR targeting current main.
- [ ] Wait for Windows/Linux x64/ARM64 native jobs to pass services, source UI, packaging and packaged UI. Investigate actual logs for any failure before changing code or retrying.

### Task 4: Publish and verify downloads

- [ ] Merge only the reviewed and passing expected PR head with a `[release]` commit title.
- [ ] Monitor the main release workflow through all four native builds and the release job.
- [ ] Confirm the published `v0.3.0` release targets the merged source and contains all 10 nonempty installers and SHA256SUMS.
- [ ] Download SHA256SUMS and verify its entries against GitHub asset digests; synchronize local main and the release tag. Report the release URL and platform limits.
