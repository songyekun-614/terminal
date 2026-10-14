import unittest

from mac_style_terminal.app import Gdk, Gio, Gtk, TerminalApplication, TerminalWindow
from test_tab_transition import pump_until


def descendants(widget):
    yield widget
    child = widget.get_first_child()
    while child:
        yield from descendants(child)
        child = child.get_next_sibling()


class TerminalMenuTests(unittest.TestCase):
    def test_native_menu_action_opens_tab_and_dismisses_popup(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        app = TerminalApplication()
        app.set_application_id("io.github.macstyle.MenuTest")
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        window = TerminalWindow(app)
        try:
            window.present()
            self.assertTrue(pump_until(lambda: window.get_mapped()))
            button = next(item for item in descendants(window)
                          if item.has_css_class("terminal-menu-button"))
            button.popup()
            popover = button.get_popover()
            self.assertTrue(pump_until(lambda: popover.get_mapped()))
            item = next(item for item in descendants(popover)
                        if item.get_css_name() == "modelbutton"
                        and any(isinstance(label, Gtk.Label) and label.get_text() == "新建标签页"
                                for label in descendants(item)))
            self.assertTrue(item.activate())
            self.assertTrue(pump_until(lambda: window.notebook.get_n_pages() == 2))
            self.assertTrue(pump_until(lambda: not popover.get_mapped()))
            self.assertIs(window.get_focus(), window.active_tab().terminal)
        finally:
            window.destroy()
