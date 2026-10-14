import unittest

from mac_style_terminal.app import adjusted_font_size, tab_title


class AppHelpersTests(unittest.TestCase):
    def test_shell_title_is_shortened_for_tab(self):
        self.assertEqual(tab_title("song@host: ~/Projects", 1), "song@host: ~/Projects")

    def test_empty_shell_title_has_stable_fallback(self):
        self.assertEqual(tab_title(None, 2), "terminal 2")

    def test_long_title_is_truncated(self):
        self.assertEqual(len(tab_title("x" * 100, 1)), 32)

    def test_zoom_reset_uses_saved_size(self):
        self.assertEqual(adjusted_font_size(21, 18, 0), 18)

    def test_zoom_respects_bounds(self):
        self.assertEqual(adjusted_font_size(32, 12, 1), 32)
        self.assertEqual(adjusted_font_size(8, 12, -1), 8)


if __name__ == "__main__":
    unittest.main()
