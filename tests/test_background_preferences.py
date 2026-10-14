import itertools
from dataclasses import replace
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

from mac_style_terminal.app import Gdk, Gio, GLib, Gtk, TerminalApplication, TerminalWindow, rgba
from mac_style_terminal.settings import BACKGROUND_PRESETS, load_settings
from test_tab_transition import pump_until
from test_terminal_menu import descendants


class BackgroundPreferencesTests(unittest.TestCase):
    ids = itertools.count()

    def setUp(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict("os.environ", {"XDG_CONFIG_HOME": self.directory.name})
        self.environment.start()
        app = TerminalApplication()
        app.set_application_id(f"io.github.macstyle.BackgroundTest{next(self.ids)}")
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        self.window = TerminalWindow(app)
        self.window.present()
        self.window.preferences()
        self.dialog = next(item for item in Gtk.Window.get_toplevels() if item.get_transient_for() is self.window)
        self.entry = next(item for item in descendants(self.dialog) if item.has_css_class("background-color-input"))
        self.save = next(item for item in descendants(self.dialog) if isinstance(item, Gtk.Button) and item.get_label() == "应用设置")
        self.profile, self.background = [item for item in descendants(self.dialog) if isinstance(item, Gtk.DropDown) and not item.has_css_class("font-family-choice") and not item.has_css_class("username-color-choice")]

    def tearDown(self):
        if hasattr(self, "window"):
            self.dialog.destroy()
            self.window.destroy()
            self.environment.stop()
            self.directory.cleanup()

    def test_custom_color_validates_saves_and_applies_to_existing_and_new_tabs(self):
        self.window.new_tab()
        self.entry.set_text("not-a-color")
        self.assertFalse(self.save.get_sensitive())
        self.entry.set_text("#fff")
        self.assertTrue(self.save.get_sensitive())
        self.save.emit("clicked")
        self.assertEqual(load_settings().background, "#ffffff")
        self.assertEqual(self.window.settings.background, "#ffffff")
        self.window.new_tab()
        for tab in self.window.tabs.values():
            color = tab.terminal.get_color_background_for_draw()
            self.assertEqual((color.red, color.green, color.blue), (1, 1, 1))

    def test_presets_picker_and_follow_profile_stay_synchronized(self):
        self.background.set_selected(4)
        self.assertEqual(self.entry.get_text(), list(BACKGROUND_PRESETS.values())[3])
        picker = next(item for item in descendants(self.dialog) if isinstance(item, Gtk.ColorDialogButton) and not item.has_css_class("username-color-picker"))
        picker.set_rgba(rgba("#123456"))
        self.assertEqual(self.entry.get_text(), "#123456")
        self.background.set_selected(0)
        self.profile.set_selected(1)
        self.assertEqual(self.entry.get_text(), "#faf9f7")
        self.save.emit("clicked")
        self.assertIsNone(load_settings().background)
        self.assertEqual(self.window.settings.profile, "Basic")

    def test_import_picker_saves_owned_wallpaper_and_transparency(self):
        source = Path(self.directory.name) / "test-wallpaper.png"
        Gdk.MemoryTexture.new(2, 2, Gdk.MemoryFormat.R8G8B8A8,
                              GLib.Bytes.new(bytes([0, 128, 255, 255]) * 4), 8).save_to_png(str(source))
        picker = MagicMock()
        picker.open_finish.return_value = Gio.File.new_for_path(str(source))
        picker.open.side_effect = lambda parent, cancellable, callback: callback(picker, object())
        button = next(item for item in descendants(self.dialog) if isinstance(item, Gtk.Button) and item.get_label() == "导入图片")
        with patch("mac_style_terminal.app.Gtk.FileDialog", return_value=picker):
            button.emit("clicked")
        transparency = next(item for item in descendants(self.dialog) if isinstance(item, Gtk.Scale))
        self.assertTrue(transparency.get_sensitive())
        transparency.set_value(80)
        frame = next(item for item in descendants(self.dialog) if item.has_css_class("background-preview"))
        self.assertTrue(pump_until(lambda: 64 <= frame.get_height() <= 70))
        self.save.emit("clicked")
        settings = load_settings()
        self.assertAlmostEqual(settings.wallpaper_opacity, 0.2)
        self.assertNotEqual(settings.wallpaper, str(source))
        source.unlink()
        self.assertTrue(Path(settings.wallpaper).is_file())

    def test_font_selection_previews_and_applies_to_all_tabs(self):
        choice = next(item for item in descendants(self.dialog) if item.has_css_class("font-family-choice"))
        model = choice.get_model()
        installed = {family.get_name() for family in self.window.get_pango_context().list_families() if family.is_monospace()}
        offered = [model.get_string(index) for index in range(1, model.get_n_items() - 1)]
        self.assertTrue(offered)
        self.assertTrue(set(offered) <= installed)
        chosen = offered[0]
        self.window.new_tab()
        choice.set_selected(1)
        size = next(item for item in descendants(self.dialog) if isinstance(item, Gtk.SpinButton))
        size.set_value(16)
        preview = next(item for item in descendants(self.dialog) if item.has_css_class("transparent-terminal"))
        self.assertEqual(preview.get_font().get_family(), chosen)
        self.assertEqual(preview.get_font().get_size(), 16 * 1024)
        self.assertEqual(self.window.settings.font_family, "Monospace")
        self.save.emit("clicked")
        self.assertEqual(load_settings().font_family, chosen)
        self.window.new_tab()
        for tab in self.window.tabs.values():
            self.assertEqual(tab.terminal.get_font().get_family(), chosen)
            self.assertEqual(tab.terminal.get_font().get_size(), 16 * 1024)
        self.window.preferences()
        self.dialog = next(item for item in Gtk.Window.get_toplevels() if item.get_transient_for() is self.window)
        reopened = next(item for item in descendants(self.dialog) if item.has_css_class("font-family-choice"))
        self.assertEqual(reopened.get_selected_item().get_string(), chosen)

    def test_closing_preferences_discards_font_selection(self):
        choice = next(item for item in descendants(self.dialog) if item.has_css_class("font-family-choice"))
        choice.set_selected(1)
        self.dialog.close()
        self.assertEqual(self.window.settings.font_family, "Monospace")
        self.assertEqual(load_settings().font_family, "Monospace")

    def test_existing_custom_font_is_preserved_and_editable(self):
        self.dialog.destroy()
        self.window.settings = replace(self.window.settings, font_family="Legacy Custom Mono")
        self.window.preferences()
        self.dialog = next(item for item in Gtk.Window.get_toplevels() if item.get_transient_for() is self.window)
        choice = next(item for item in descendants(self.dialog) if item.has_css_class("font-family-choice"))
        entry = next(item for item in descendants(self.dialog) if item.has_css_class("font-family-input"))
        self.assertEqual(choice.get_selected_item().get_string(), "自定义字体")
        self.assertTrue(entry.get_visible())
        self.assertEqual(entry.get_text(), "Legacy Custom Mono")
        entry.set_text("My Custom Mono")
        save = next(item for item in descendants(self.dialog) if isinstance(item, Gtk.Button) and item.get_label() == "应用设置")
        save.emit("clicked")
        self.assertEqual(load_settings().font_family, "My Custom Mono")

    def test_username_presets_custom_picker_and_validation_save(self):
        choice = next(item for item in descendants(self.dialog) if item.has_css_class("username-color-choice"))
        entry = next(item for item in descendants(self.dialog) if item.has_css_class("username-color-input"))
        picker = next(item for item in descendants(self.dialog) if item.has_css_class("username-color-picker"))
        choice.set_selected(1)
        self.assertEqual(entry.get_text(), "#5b9dff")
        self.assertEqual(self.window.settings.username_color, "#28c840")
        entry.set_text("invalid")
        self.assertFalse(self.save.get_sensitive())
        self.entry.set_text("#fff")
        self.assertFalse(self.save.get_sensitive())
        entry.set_text("#abc")
        self.assertTrue(self.save.get_sensitive())
        self.assertEqual(choice.get_selected_item().get_string(), "自定义")
        picker.set_rgba(rgba("#123456"))
        self.assertEqual(entry.get_text(), "#123456")
        self.save.emit("clicked")
        self.assertEqual(load_settings().username_color, "#123456")
        self.window.preferences()
        self.dialog = next(item for item in Gtk.Window.get_toplevels() if item.get_transient_for() is self.window)
        reopened = next(item for item in descendants(self.dialog) if item.has_css_class("username-color-input"))
        self.assertEqual(reopened.get_text(), "#123456")
