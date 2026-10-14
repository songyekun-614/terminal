import itertools
import unittest

from mac_style_terminal.app import Gdk, Gio, Gtk, TerminalApplication, TerminalWindow
from test_tab_transition import pump_until
from test_terminal_menu import descendants


class TabRenameTests(unittest.TestCase):
    ids = itertools.count()

    def setUp(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        self.app = TerminalApplication()
        self.app.set_application_id(f"io.github.macstyle.RenameTest{next(self.ids)}")
        self.app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        self.app.register(None)
        self.window = TerminalWindow(self.app)
        self.window.present()
        self.assertTrue(pump_until(lambda: self.window.active_tab().child_pid is not None, timeout=8))

    def tearDown(self):
        if hasattr(self, "window"):
            for item in list(Gtk.Window.get_toplevels()):
                if item.get_transient_for() is self.window:
                    item.destroy()
            self.window.destroy()

    def editor(self):
        dialog = next(item for item in Gtk.Window.get_toplevels()
                      if isinstance(item, Gtk.Dialog) and item.get_transient_for() is self.window)
        entry = next(item for item in descendants(dialog) if isinstance(item, Gtk.Entry))
        return dialog, entry

    def test_name_survives_shell_updates_and_blank_restores_latest_title(self):
        first = self.window.active_tab()
        self.window.new_tab()
        second = self.window.active_tab()
        self.window.rename_tab(first)
        dialog, entry = self.editor()
        entry.set_text("开发服务器")
        dialog.response(Gtk.ResponseType.ACCEPT)
        self.assertEqual(first.label.get_text(), "开发服务器")
        self.assertNotEqual(second.label.get_text(), "开发服务器")
        first.terminal.feed(b"\x1b]0;latest-shell-title\x07")
        self.assertTrue(pump_until(lambda: first.terminal.get_termprop_string("xterm.title")[0] == "latest-shell-title"))
        self.assertEqual(first.label.get_text(), "开发服务器")
        self.window.rename_tab(first)
        dialog, entry = self.editor()
        entry.set_text("  ")
        dialog.response(Gtk.ResponseType.ACCEPT)
        self.assertEqual(first.label.get_text(), "latest-shell-title")
        self.assertEqual(first.label.get_tooltip_text(), "latest-shell-title")

    def test_menu_action_supports_enter_save_and_escape_cancel(self):
        tab = self.window.active_tab()
        self.assertTrue(self.window.activate_action("win.rename-tab", None))
        dialog, entry = self.editor()
        self.assertTrue(pump_until(lambda: dialog.get_mapped()))
        entry.set_text("日志")
        entry.get_delegate().emit("activate")
        self.assertTrue(pump_until(lambda: tab.label.get_text() == "日志"))
        self.assertIn("日志", self.window.get_title())
        self.window.activate_action("win.rename-tab", None)
        dialog, entry = self.editor()
        entry.set_text("不保存")
        dialog.emit("close")
        self.assertEqual(tab.label.get_text(), "日志")
