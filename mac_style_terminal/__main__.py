"""Run the desktop application with useful dependency errors."""

import sys

try:
    from .app import Gdk, Gtk, TerminalApplication
except (ImportError, ValueError) as error:
    print(f"Missing GTK/VTE dependency: {error}", file=sys.stderr)
    print("On Debian 13: sudo apt install python3-gi gir1.2-gtk-4.0 gir1.2-vte-3.91 libvte-2.91-gtk4-0", file=sys.stderr)
    raise SystemExit(2)

if not Gtk.init_check() or Gdk.Display.get_default() is None:
    print("No graphical display is available. Start this application from a desktop session.", file=sys.stderr)
    raise SystemExit(3)

raise SystemExit(TerminalApplication().run())
