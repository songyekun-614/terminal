from dataclasses import replace
import itertools
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from mac_style_terminal.app import Gdk, Gio, GLib, Gtk, Vte, TerminalApplication, TerminalWindow
from mac_style_terminal.settings import load_settings
from mac_style_terminal.wallpaper import import_wallpaper, load_wallpaper, remove_wallpaper_copy
from test_tab_transition import pump_until


class WallpaperTests(unittest.TestCase):
    ids = itertools.count()

    def setUp(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict("os.environ", {"XDG_CONFIG_HOME": self.directory.name})
        self.environment.start()
        self.source = Path(self.directory.name) / "sample.png"
        image = Gdk.MemoryTexture.new(2, 2, Gdk.MemoryFormat.R8G8B8A8, GLib.Bytes.new(bytes([255, 0, 0, 255]) * 4), 8)
        image.save_to_png(str(self.source))

    def tearDown(self):
        if hasattr(self, "window"):
            self.window.destroy()
        if hasattr(self, "environment"):
            self.environment.stop()
            self.directory.cleanup()

    def test_imported_image_survives_original_removal_and_corrupt_file_is_rejected(self):
        imported = import_wallpaper(str(self.source))
        self.assertNotEqual(imported, str(self.source))
        self.assertEqual(import_wallpaper(imported), imported)
        self.source.unlink()
        self.assertIsNotNone(load_wallpaper(imported))
        remove_wallpaper_copy(imported)
        self.assertFalse(Path(imported).exists())
        self.source.write_text("not an image")
        remove_wallpaper_copy(str(self.source))
        self.assertTrue(self.source.exists())
        with self.assertRaises(ValueError):
            import_wallpaper(str(self.source))

    def create_window(self):
        app = TerminalApplication()
        app.set_application_id(f"io.github.macstyle.WallpaperTest{next(self.ids)}")
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        self.window = TerminalWindow(app)
        self.window.present()
        return self.window

    def test_opacity_is_rendered_below_live_terminal_and_shared_with_new_tabs(self):
        window = self.create_window()
        imported = import_wallpaper(str(self.source))
        window.settings = replace(window.settings, background="#000000", wallpaper=imported, wallpaper_opacity=0.5)
        window._save_and_apply()
        tab = window.active_tab()
        self.assertTrue(pump_until(lambda: tab.child_pid is not None and tab.page.get_width() > 0, timeout=8))
        clock = window.get_frame_clock()
        frame = clock.get_frame_counter()
        self.assertTrue(pump_until(lambda: clock.get_frame_counter() > frame + 1))
        snapshot = Gtk.Snapshot()
        Gtk.WidgetPaintable.new(tab.page).get_current_image().snapshot(snapshot, tab.page.get_width(), tab.page.get_height())
        texture = window.get_renderer().render_texture(snapshot.to_node(), None)
        downloader = Gdk.TextureDownloader.new(texture)
        downloader.set_format(Gdk.MemoryFormat.R8G8B8A8)
        pixels, stride = downloader.download_bytes()
        red, green, blue, _alpha = pixels.get_data()[2 * stride + 8:2 * stride + 12]
        self.assertAlmostEqual(red, 128, delta=2)
        self.assertEqual((green, blue), (0, 0))
        red, green, blue, _alpha = pixels.get_data()[100 * stride + 400:100 * stride + 404]
        self.assertAlmostEqual(red, 128, delta=2)
        self.assertEqual((green, blue), (0, 0))
        self.assertFalse(tab.background_surface.picture.get_can_target())
        window.new_tab()
        active = window.active_tab()
        self.assertIs(active.background_surface.picture.get_paintable(), window._wallpaper_texture)
        self.assertAlmostEqual(active.background_surface.picture.get_opacity(), 0.5, delta=1 / 255)
        self.assertTrue(pump_until(lambda: active.child_pid is not None, timeout=8))
        active.terminal.feed_child(b"printf 'WALLPAPER_%s\\n' 'INPUT_OK'\n")
        self.assertTrue(pump_until(lambda: "WALLPAPER_INPUT_OK" in (active.terminal.get_text_format(Vte.Format.TEXT) or "")))
        self.assertEqual(load_settings().wallpaper_opacity, 0.5)
        window.settings = replace(window.settings, wallpaper=None)
        window._save_and_apply()
        self.assertEqual(active.terminal.get_color_background_for_draw().alpha, 1)
        self.assertFalse(active.background_surface.picture.get_visible())

    def test_missing_wallpaper_falls_back_to_solid_background(self):
        window = self.create_window()
        window.settings = replace(window.settings, wallpaper="/nonexistent/terminal-wallpaper.png")
        window._save_and_apply()
        self.assertIsNone(window._wallpaper_texture)
        self.assertEqual(window.active_tab().terminal.get_color_background_for_draw().alpha, 1)
