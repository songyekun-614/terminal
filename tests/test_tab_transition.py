import time
import unittest

from mac_style_terminal.app import Gdk, GLib, Gtk
from mac_style_terminal.transitions import TabTransition


def pump_until(predicate, timeout=2):
    context = GLib.MainContext.default()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        while context.pending():
            context.iteration(False)
        if predicate():
            return True
        time.sleep(0.005)
    return False


class TabTransitionTests(unittest.TestCase):
    def setUp(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        self.settings = Gtk.Settings.get_default()
        self.animations = self.settings.get_property("gtk-enable-animations")
        self.settings.set_property("gtk-enable-animations", True)
        self.window = Gtk.Window(default_width=320, default_height=180)
        self.stack = Gtk.Stack()
        self.pages = []
        for text in ("First terminal", "Second terminal"):
            page = Gtk.Overlay()
            page.set_child(Gtk.Label(label=text))
            self.stack.add_child(page)
            self.pages.append(page)
        self.window.set_child(self.stack)
        self.window.present()
        self.transition = TabTransition()
        self.assertTrue(pump_until(lambda: self.pages[0].get_width() > 0))

    def tearDown(self):
        if hasattr(self, "transition"):
            self.transition.stop()
            self.window.destroy()
            self.settings.set_property("gtk-enable-animations", self.animations)

    def switch(self, page):
        image = self.transition.capture(self.stack.get_visible_child())
        self.stack.set_visible_child(page)
        self.transition.start(page, image)

    def test_outgoing_snapshot_fades_and_does_not_intercept_input(self):
        self.switch(self.pages[1])
        self.assertTrue(self.transition.running)
        picture = self.pages[1].get_last_child()
        self.assertIsInstance(picture, Gtk.Picture)
        self.assertFalse(picture.get_can_target())
        self.assertTrue(pump_until(lambda: 0 < picture.get_opacity() < 0.9))
        self.assertTrue(pump_until(lambda: not self.transition.running))
        self.assertIs(self.stack.get_visible_child(), self.pages[1])
        self.assertIs(self.pages[1].get_last_child(), self.pages[1].get_child())

    def test_rapid_switches_finish_on_the_last_selected_page(self):
        for index in range(12):
            self.switch(self.pages[(index + 1) % 2])
        self.assertTrue(pump_until(lambda: not self.transition.running))
        self.assertIs(self.stack.get_visible_child(), self.pages[0])
        for page in self.pages:
            self.assertIs(page.get_last_child(), page.get_child())

    def test_interrupted_fade_preserves_the_visible_blended_frame(self):
        # Give loaded renderers a wide sampling window; this test checks pixels,
        # while the other transition tests exercise the production duration.
        self.transition.duration_ms = 2000
        provider = Gtk.CssProvider()
        provider.load_from_string(".motion-red { background: #ff0000; } .motion-blue { background: #0000ff; }")
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        try:
            self.pages[0].get_child().add_css_class("motion-red")
            self.pages[1].get_child().add_css_class("motion-blue")
            clock = self.window.get_frame_clock()
            initial_frame = clock.get_frame_counter()
            self.assertTrue(pump_until(lambda: clock.get_frame_counter() > initial_frame + 1))
            self.switch(self.pages[1])
            picture = self.pages[1].get_last_child()
            self.assertTrue(pump_until(lambda: 0.65 < picture.get_opacity() < 0.9))
            image = self.transition.capture(self.pages[1])
            snapshot = Gtk.Snapshot()
            image.snapshot(snapshot, 320, 180)
            texture = self.window.get_renderer().render_texture(snapshot.to_node(), None)
            downloader = Gdk.TextureDownloader.new(texture)
            downloader.set_format(Gdk.MemoryFormat.R8G8B8A8)
            pixels, stride = downloader.download_bytes()
            data = pixels.get_data()
            offset = 20 * stride + 20 * 4
            red, _green, blue, _alpha = data[offset:offset + 4]
            self.assertGreater(red, blue, "Interrupting dropped the visible red frame and jumped to blue")
        finally:
            Gtk.StyleContext.remove_provider_for_display(Gdk.Display.get_default(), provider)

    def test_system_disabled_animations_skip_transition(self):
        self.settings.set_property("gtk-enable-animations", False)
        self.switch(self.pages[1])
        self.assertFalse(self.transition.running)
        self.assertIs(self.pages[1].get_last_child(), self.pages[1].get_child())
