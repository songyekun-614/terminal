import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mac_style_terminal.settings import (
    Settings,
    config_path,
    load_settings,
    save_settings,
    normalize_background,
    terminal_palette,
)


class SettingsTests(unittest.TestCase):
    def test_username_color_is_saved_validated_and_compatible_with_old_configs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            chosen = Settings(username_color="#123456")
            save_settings(chosen, path)
            self.assertEqual(load_settings(path), chosen)
            path.write_text('{"username_color": "#ABC", "font_size": 15}')
            self.assertEqual(load_settings(path).username_color, "#aabbcc")
            for value in ('{}', '{"username_color": "$(touch /tmp/bad)"}'):
                path.write_text(value)
                self.assertEqual(load_settings(path).username_color, "#28c840")

    def test_wallpaper_and_opacity_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            chosen = Settings(wallpaper="/tmp/wallpaper.png", wallpaper_opacity=0.6)
            save_settings(chosen, path)
            self.assertEqual(load_settings(path), chosen)
            path.write_text(json.dumps({"wallpaper": "relative.png", "wallpaper_opacity": 7}))
            self.assertEqual(load_settings(path), Settings())
    def test_custom_background_round_trips_and_accepts_short_hex(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            chosen = Settings(background="#123456")
            save_settings(chosen, path)
            self.assertEqual(load_settings(path), chosen)
            self.assertEqual(normalize_background(" #ABC "), "#aabbcc")

    def test_invalid_background_is_ignored_without_losing_other_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            path.write_text(json.dumps({"profile": "Basic", "background": "red; color:white"}))
            self.assertEqual(load_settings(path), Settings(profile="Basic"))

    def test_custom_background_uses_readable_foreground(self):
        self.assertEqual(terminal_palette(Settings(background="#ffffff"))["foreground"], "#242528")
        self.assertEqual(terminal_palette(Settings(profile="Basic", background="#000000"))["foreground"], "#f2f2f4")
        self.assertEqual(terminal_palette(Settings(background="#777777"))["foreground"], "#000000")

    def test_defaults_when_file_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(load_settings(Path(directory) / "missing.json"), Settings())

    def test_invalid_values_fall_back_individually(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            path.write_text(json.dumps({"profile": "unknown", "font_family": "", "font_size": 200}), encoding="utf-8")
            self.assertEqual(load_settings(path), Settings())

    def test_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            chosen = Settings(profile="Basic", font_family="DejaVu Sans Mono", font_size=15)
            save_settings(chosen, path)
            self.assertEqual(load_settings(path), chosen)

    def test_bad_json_uses_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            path.write_text("{", encoding="utf-8")
            self.assertEqual(load_settings(path), Settings())

    def test_xdg_config_path(self):
        with patch.dict("os.environ", {"XDG_CONFIG_HOME": "/tmp/custom-config"}):
            self.assertEqual(config_path(), Path("/tmp/custom-config/mac-style-terminal/settings.json"))


if __name__ == "__main__":
    unittest.main()
