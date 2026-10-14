import unittest

from mac_style_terminal.app import Gdk, Gio, Gtk, TerminalApplication, TerminalWindow
from mac_style_terminal.transitions import PopupReveal
from test_tab_transition import pump_until


class PopupRevealTests(unittest.TestCase):
    def setUp(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        self.settings = Gtk.Settings.get_default()
        self.animations = self.settings.get_property("gtk-enable-animations")
        self.settings.set_property("gtk-enable-animations", True)
        self.parent = Gtk.Window()
        self.parent.present()
        self.dialog = Gtk.Dialog(title="Confirmation", transient_for=self.parent, modal=True)
        self.dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
        self.dialog.connect("response", lambda dialog, response: dialog.destroy())
        self.reveal = PopupReveal(self.dialog)

    def tearDown(self):
        if hasattr(self, "reveal"):
            self.dialog.destroy()
            self.parent.destroy()
            self.settings.set_property("gtk-enable-animations", self.animations)

    def test_popup_fades_in_and_remains_interactive(self):
        self.reveal.present()
        self.assertLess(self.dialog.get_opacity(), 0.1)
        self.assertTrue(pump_until(lambda: 0.1 < self.dialog.get_opacity() < 0.95))
        self.assertIsNotNone(self.dialog.get_focus())
        self.assertTrue(pump_until(lambda: not self.reveal.running))
        self.assertEqual(self.dialog.get_opacity(), 1)

    def test_cancel_during_reveal_clears_animation(self):
        self.reveal.present()
        self.assertTrue(pump_until(lambda: self.reveal.running and self.dialog.get_mapped()))
        self.dialog.response(Gtk.ResponseType.CANCEL)
        self.assertFalse(self.reveal.running)
        self.assertEqual(self.dialog.get_opacity(), 1)

    def test_disabled_animations_show_popup_immediately(self):
        self.settings.set_property("gtk-enable-animations", False)
        self.reveal.present()
        self.assertEqual(self.dialog.get_opacity(), 1)
        self.assertFalse(self.reveal.running)

    def test_disabling_animations_midway_finishes_reveal(self):
        self.reveal.present()
        self.assertTrue(pump_until(lambda: 0.1 < self.dialog.get_opacity() < 0.95))
        self.settings.set_property("gtk-enable-animations", False)
        self.assertTrue(pump_until(lambda: not self.reveal.running))
        self.assertEqual(self.dialog.get_opacity(), 1)


class ConfirmationIntegrationTests(unittest.TestCase):
    def test_close_icon_confirmation_can_cancel_and_confirm(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        settings = Gtk.Settings.get_default()
        animations = settings.get_property("gtk-enable-animations")
        settings.set_property("gtk-enable-animations", True)
        app = TerminalApplication()
        app.set_application_id("io.github.macstyle.PopupTest")
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        window = TerminalWindow(app)
        try:
            window.present()
            tab = window.active_tab()
            self.assertTrue(pump_until(lambda: tab.child_pid is not None, timeout=8))
            for response in (Gtk.ResponseType.CANCEL, Gtk.ResponseType.ACCEPT):
                window.close()
                dialogs = [item for item in Gtk.Window.get_toplevels()
                           if isinstance(item, Gtk.Dialog) and item.get_transient_for() is window]
                self.assertEqual(len(dialogs), 1)
                dialog = dialogs[0]
                cancel = dialog.get_widget_for_response(Gtk.ResponseType.CANCEL)
                self.assertIs(dialog.get_default_widget(), cancel)
                self.assertLess(dialog.get_opacity(), 0.1)
                self.assertTrue(pump_until(lambda: 0.1 < dialog.get_opacity() < 0.95))
                self.assertIs(dialog.get_focus(), cancel)
                if response == Gtk.ResponseType.CANCEL:
                    # Gtk.Dialog's native Escape action emits close.
                    dialog.emit("close")
                else:
                    dialog.response(response)
                if response == Gtk.ResponseType.CANCEL:
                    self.assertTrue(window.get_mapped())
                    self.assertTrue(tab.running)
                else:
                    self.assertFalse(window.get_mapped())
        finally:
            window.destroy()
            settings.set_property("gtk-enable-animations", animations)

