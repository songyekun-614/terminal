# Mac Style Terminal Design

## Goal

Build a standalone Debian 13 desktop terminal inspired by the restrained layout of Apple's Terminal app. It runs the user's real shell in a VTE widget and offers tabs and a small set of appearance profiles.

## Scope

- One application window with a compact header, tab strip, and terminal area.
- New, switch, reorder, and close tabs; closing a running tab asks for confirmation.
- Real shell sessions with scrolling, selection, copy, paste, and working directory inheritance for new tabs.
- Dark and light profiles; editable monospace font size and color choices stored in the XDG config directory.
- Familiar keyboard shortcuts for tabs, copy, paste, zoom, search, and preferences.
- Debian launcher, dependency list, and README.

## Architecture

Python 3 and PyGObject create a GTK4 window. VTE 3.91 owns each pseudo-terminal and shell process. A settings module loads and validates JSON from `~/.config/mac-style-terminal/settings.json`; the UI applies settings to every open tab. A small app module owns tabs, actions, and dialogs. UI styling uses CSS and the desktop theme; macOS branding and exact platform window controls are not copied.

## Behavior and failure handling

The application starts the shell from `$SHELL` if it is executable, otherwise `/bin/sh`. A new tab opens in the active terminal's current local directory when VTE reports one, otherwise the user's home directory. If shell spawning fails, the tab shows an error with a retry action. On child exit, the tab displays an exit message and can be closed. Settings with invalid values fall back to defaults. The app remains usable when settings cannot be saved and shows an error toast.

## Verification

Automated tests cover settings validation and paths. A launch smoke check verifies imports and a real terminal window in the available desktop session after dependencies are present. Manual checks cover shell input, tab lifecycle, copy/paste, preferences, and persistence.
