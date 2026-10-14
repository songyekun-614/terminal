# Mac Style Terminal Implementation Plan

> **For agentic workers:** Implement tasks in order with test-first cycles and review each completed task.

**Goal:** Deliver a Debian 13 terminal application with a Mac-inspired interface and real shell sessions.

**Architecture:** Python/PyGObject drives GTK4. VTE 3.91 provides PTY terminal sessions. Settings are validated and saved as JSON in the XDG config directory.

**Tech Stack:** Python 3, GTK4, VTE 3.91, unittest.

**Spec:** `docs/superpowers/specs/2026-10-13-mac-style-terminal-design.md`

## Global Constraints

- Runs on Debian 13.
- Lives in `/home/song/Projects/mac-style-terminal`.
- Uses the user's shell and does not require root at runtime.
- Keeps visual inspiration to generic layout and spacing; no Apple assets.

---

### Task 1: Settings

**Files:** `mac_style_terminal/settings.py`, `tests/test_settings.py`

- [ ] Write tests for defaults, invalid values, XDG path, and save/load round-trip.
- [ ] Run tests and confirm expected failures.
- [ ] Implement typed settings validation and atomic save.
- [ ] Run tests to green.

### Task 2: Terminal application

**Files:** `mac_style_terminal/app.py`, `mac_style_terminal/__main__.py`, `mac_style_terminal/style.css`

- [ ] Write a smoke test for import, shell resolution, and title/working-directory helpers.
- [ ] Confirm expected failures.
- [ ] Implement GTK4/libadwaita window, VTE tabs, actions, settings dialog, and CSS.
- [ ] Run tests and desktop smoke check.

### Task 3: Delivery

**Files:** `README.md`, `bin/mac-style-terminal`, `packaging/mac-style-terminal.desktop`

- [ ] Document Debian packages, launching, shortcuts, and desktop integration.
- [ ] Verify script syntax, application imports, tests, and live terminal behavior.
- [ ] Copy the reviewed project to the target directory.
