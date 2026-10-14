import itertools
import unittest

from mac_style_terminal.app import Gdk, Gio, Gtk, TerminalApplication, TerminalWindow
from test_tab_transition import pump_until


class TabBarTests(unittest.TestCase):
    ids = itertools.count()

    def setUp(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        app = TerminalApplication()
        app.set_application_id(f"io.github.macstyle.TabBarTest{next(self.ids)}")
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        self.window = TerminalWindow(app)
        self.window.present()
        self.assertTrue(pump_until(lambda: self.window.notebook.get_width() > 0))

    def tearDown(self):
        if hasattr(self, "window"):
            self.window.destroy()

    def click(self, count, x, y):
        self.window._tab_bar_click.emit("pressed", count, float(x), float(y))

    def center(self, widget):
        ok, bounds = widget.compute_bounds(self.window.notebook)
        self.assertTrue(ok)
        return bounds.get_x() + bounds.get_width() / 2, bounds.get_y() + bounds.get_height() / 2

    def test_blank_double_click_opens_and_focuses_new_terminal(self):
        header = self.window.notebook.get_first_child()
        self.click(2, self.window.notebook.get_width() - 24, header.get_height() / 2)
        self.assertEqual(self.window.notebook.get_n_pages(), 2)
        tab = self.window.active_tab()
        self.assertTrue(pump_until(lambda: tab.child_pid is not None, timeout=8))
        self.assertIs(self.window.get_focus(), tab.terminal)

    def test_single_click_and_double_click_on_controls_or_content_do_not_add_tabs(self):
        notebook = self.window.notebook
        header = notebook.get_first_child()
        self.click(1, notebook.get_width() - 24, header.get_height() / 2)
        tab = self.window.active_tab()
        for widget in (tab.label, notebook.get_tab_label(tab.page).get_last_child(), tab.terminal):
            self.click(2, *self.center(widget))
        # Padding belongs to the existing tab, rather than the empty tab bar.
        ok, bounds = notebook.get_tab_label(tab.page).compute_bounds(notebook)
        self.assertTrue(ok)
        self.click(2, bounds.get_x() - 4, bounds.get_y() + bounds.get_height() / 2)
        self.assertEqual(notebook.get_n_pages(), 1)
