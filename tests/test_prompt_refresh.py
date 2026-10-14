import itertools
import os
import tempfile
import unittest
from unittest.mock import patch

from mac_style_terminal.app import Gdk, Gio, Gtk, Vte, TerminalApplication, TerminalWindow
from mac_style_terminal.settings import Settings
from test_tab_transition import pump_until


class PromptRefreshBoundaryTests(unittest.TestCase):
    ids = itertools.count()

    def setUp(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest('A desktop display is required')
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict('os.environ', {'XDG_CONFIG_HOME': self.directory.name, 'SHELL': '/bin/bash'})
        self.environment.start()
        app = TerminalApplication()
        app.set_application_id(f'io.github.macstyle.PromptBoundary{next(self.ids)}')
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        self.window = TerminalWindow(app)
        self.window.present()
        self.tab = self.window.active_tab()
        self.assertTrue(pump_until(lambda: self.tab.prompt_refresh.prompt_row is not None))

    def tearDown(self):
        if hasattr(self, 'window'):
            self.window.destroy()
            self.environment.stop()
            self.directory.cleanup()

    def text(self):
        return self.tab.terminal.get_text_format(Vte.Format.TEXT) or ''

    def apply_color(self):
        self.window.settings = Settings(username_color='#aabbcc')
        self.assertTrue(self.window._save_and_apply())
        self.assertTrue(pump_until(lambda: self.tab.prompt_refresh.source == 0))

    def test_builtin_read_does_not_repaint_old_prompt_or_receive_any_input(self):
        self.tab.terminal.feed_child(b"read -r response; printf 'READ_%s:%s\\n' 'DONE' \"$response\"\n")
        self.assertTrue(pump_until(lambda: self.tab.prompt_refresh.prompt_row is None))
        self.assertEqual(os.tcgetpgrp(self.tab.terminal.get_pty().get_fd()), self.tab.child_pid)
        before = self.text()
        self.apply_color()
        self.assertEqual(self.text(), before)
        self.assertNotIn('#AABBCC', self.tab.terminal.get_text_format(Vte.Format.HTML) or '')
        self.tab.terminal.feed_child(b'hello\n')
        self.assertTrue(pump_until(lambda: 'READ_DONE:hello' in self.text()))
        self.assertTrue(pump_until(lambda: '#AABBCC' in (self.tab.terminal.get_text_format(Vte.Format.HTML) or '')))

    def test_prompt_without_names_does_not_repaint_historical_prompt(self):
        self.tab.terminal.feed_child(b"PS1='custom> '\n")
        self.assertTrue(pump_until(lambda: self.text().count('custom> ') >= 2 and self.tab.prompt_refresh.prompt_row is not None))
        before = self.tab.terminal.get_text_format(Vte.Format.HTML)
        self.apply_color()
        self.assertEqual(self.tab.terminal.get_text_format(Vte.Format.HTML), before)

    def test_emoji_prefix_uses_native_cell_positions_and_preserves_text(self):
        self.tab.terminal.feed_child("PS1='👨‍💻 \\u@\\h> '\n".encode())
        self.assertTrue(pump_until(lambda: self.text().count('👨‍💻 ') >= 2 and self.tab.prompt_refresh.prompt_row is not None))
        before = self.text()
        cursor = self.tab.terminal.get_cursor_position()
        self.apply_color()
        self.assertTrue(pump_until(lambda: '#AABBCC' in (self.tab.terminal.get_text_format(Vte.Format.HTML) or '')))
        self.assertEqual(self.text(), before)
        self.assertEqual(self.tab.terminal.get_cursor_position(), cursor)
