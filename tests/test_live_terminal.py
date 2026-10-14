import time
import tempfile
import os
import unittest
from unittest.mock import patch

from mac_style_terminal.app import Gdk, Gio, GLib, Gtk, Vte, TerminalApplication, TerminalWindow
from mac_style_terminal.settings import Settings, save_settings


class LiveTerminalTests(unittest.TestCase):
    def test_username_color_updates_existing_bash_prompt_without_restarting_shell(self):
        from test_tab_transition import pump_until

        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"XDG_CONFIG_HOME": directory, "SHELL": "/bin/bash"}):
            save_settings(Settings(username_color="#123456"))
            app = TerminalApplication()
            app.set_application_id("io.github.macstyle.UsernameColorTest")
            app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
            app.register(None)
            window = TerminalWindow(app)
            try:
                window.present()
                tab = window.active_tab()
                self.assertTrue(pump_until(lambda: tab.child_pid is not None, timeout=8))
                pid = tab.child_pid
                tab.terminal.feed_child(b"printf '\\nPROMPT_%s=%s\\n' 'ONE' \"$PS1\"\n")
                self.assertTrue(pump_until(lambda: "38;2;18;52;86m" in (tab.terminal.get_text_format(Vte.Format.TEXT) or "")))
                window.settings = Settings(username_color="#aabbcc")
                self.assertTrue(window._save_and_apply())
                self.assertTrue(pump_until(lambda: '#AABBCC' in (tab.terminal.get_text_format(Vte.Format.HTML) or "")),
                                           "Current prompt did not repaint without shell input")
                tab.terminal.feed_child(b"\nprintf '\\nPROMPT_%s=%s\\n' 'TWO' \"$PS1\"\n")
                self.assertTrue(pump_until(lambda: "38;2;170;187;204m" in (tab.terminal.get_text_format(Vte.Format.TEXT) or "")))
                self.assertEqual(tab.child_pid, pid)
                self.assertTrue(tab.running)
            finally:
                window.destroy()

    def test_prompt_color_refresh_preserves_unsubmitted_input_and_cursor(self):
        from test_tab_transition import pump_until

        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"XDG_CONFIG_HOME": directory, "SHELL": "/bin/bash"}):
            app = TerminalApplication()
            app.set_application_id("io.github.macstyle.PromptInputTest")
            app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
            app.register(None)
            window = TerminalWindow(app)
            try:
                window.present()
                tab = window.active_tab()
                self.assertTrue(pump_until(lambda: tab.child_pid is not None and "@" in (tab.terminal.get_text_format(Vte.Format.TEXT) or "")))
                tab.terminal.feed_child(b"for i in {1..60}; do printf 'row_%s\\n' \"$i\"; done\n")
                self.assertTrue(pump_until(lambda: "row_60" in (tab.terminal.get_text_format(Vte.Format.TEXT) or "")))
                tab.terminal.feed_child(b"printf 'PENDING_%s\\n' 'OK'")
                self.assertTrue(pump_until(lambda: "'OK'" in (tab.terminal.get_text_format(Vte.Format.TEXT) or "")))
                end_column = tab.terminal.get_cursor_position().column
                tab.terminal.feed_child(b"\x02\x02\x02")
                self.assertTrue(pump_until(lambda: tab.terminal.get_cursor_position().column == end_column - 3))
                text = tab.terminal.get_text_format(Vte.Format.TEXT)
                cursor = tab.terminal.get_cursor_position()
                window.settings = Settings(username_color="#aabbcc")
                self.assertTrue(window._save_and_apply())
                self.assertTrue(pump_until(lambda: '#AABBCC' in (tab.terminal.get_text_format(Vte.Format.HTML) or "")))
                self.assertEqual(tab.terminal.get_text_format(Vte.Format.TEXT), text)
                self.assertEqual(tab.terminal.get_cursor_position(), cursor)
                self.assertNotIn("PENDING_OK", text)
                changes = []
                handler = tab.terminal.connect("contents-changed", lambda *_args: changes.append(True))
                tab.terminal.feed_child(b"\x0c")
                self.assertTrue(pump_until(lambda: bool(changes)))
                self.assertTrue(pump_until(lambda: '#AABBCC' in (tab.terminal.get_text_format(Vte.Format.HTML) or "")))
                tab.terminal.disconnect(handler)
                tab.terminal.feed_child(b"\n")
                self.assertTrue(pump_until(lambda: "PENDING_OK" in (tab.terminal.get_text_format(Vte.Format.TEXT) or "")))
            finally:
                window.destroy()

    def test_changing_prompt_color_does_not_interrupt_foreground_command(self):
        from test_tab_transition import pump_until

        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"XDG_CONFIG_HOME": directory, "SHELL": "/bin/bash"}):
            app = TerminalApplication()
            app.set_application_id("io.github.macstyle.PromptBusyTest")
            app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
            app.register(None)
            window = TerminalWindow(app)
            try:
                window.present()
                tab = window.active_tab()
                self.assertTrue(pump_until(lambda: tab.child_pid is not None))
                tab.terminal.feed_child(b"sleep 0.6; printf 'JOB_%s\\n' 'DONE'\n")
                self.assertTrue(pump_until(lambda: os.tcgetpgrp(tab.terminal.get_pty().get_fd()) != tab.child_pid))
                window.settings = Settings(username_color="#aabbcc")
                self.assertTrue(window._save_and_apply())
                self.assertFalse(tab.prompt_refresh.refresh())
                self.assertNotIn('#AABBCC', tab.terminal.get_text_format(Vte.Format.HTML) or "")
                self.assertTrue(pump_until(lambda: "JOB_DONE" in (tab.terminal.get_text_format(Vte.Format.TEXT) or "")))
                self.assertTrue(pump_until(lambda: '#AABBCC' in (tab.terminal.get_text_format(Vte.Format.HTML) or "")))
                self.assertTrue(tab.running)
            finally:
                window.destroy()

    def test_shell_gets_color_capable_term_even_from_a_dumb_parent(self):
        from test_tab_transition import pump_until

        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        app = TerminalApplication()
        app.set_application_id("io.github.macstyle.ColorTermTest")
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        with patch.dict("os.environ", {"TERM": "dumb"}):
            window = TerminalWindow(app)
            try:
                window.present()
                tab = window.active_tab()
                self.assertTrue(pump_until(lambda: tab.child_pid is not None, timeout=8))
                tab.terminal.feed_child(b"printf '\\nCOLOR_TERM=%s\\n' \"$TERM\"\n")
                self.assertTrue(pump_until(lambda: "COLOR_TERM=xterm-256color" in (tab.terminal.get_text_format(Vte.Format.TEXT) or ""), timeout=3))
            finally:
                window.destroy()

    def test_tab_width_grows_and_shrinks_with_shell_title(self):
        from test_tab_transition import pump_until

        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        app = TerminalApplication()
        app.set_application_id("io.github.macstyle.TabWidthTest")
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        window = TerminalWindow(app)
        try:
            window.present()
            tab = window.active_tab()
            self.assertTrue(pump_until(lambda: tab.child_pid is not None and tab.label.get_mapped(), timeout=8))
            widths = []
            for title in ("sh", "debian-shell", "任务终端" * 20, "sh"):
                tab.terminal.feed(("\x1b]0;" + title + "\x07").encode())
                self.assertTrue(pump_until(lambda: tab.label.get_tooltip_text() == title))
                self.assertTrue(pump_until(lambda: tab.label.get_width() == tab.label.get_size_request()[0]))
                widths.append(tab.label.get_width())
            self.assertLess(widths[0], widths[1])
            self.assertLess(widths[1], widths[2])
            self.assertLessEqual(widths[2], 160)
            self.assertEqual(widths[0], widths[3])
        finally:
            window.destroy()

    def test_switch_updates_title_and_input_focus_immediately(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        app = TerminalApplication()
        app.set_application_id("io.github.macstyle.SwitchTest")
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        window = TerminalWindow(app)
        try:
            window.present()
            first = window.active_tab()
            window.new_tab()
            second = window.active_tab()
            context = GLib.MainContext.default()
            deadline = time.monotonic() + 8
            while (first.child_pid is None or second.child_pid is None) and time.monotonic() < deadline:
                while context.pending():
                    context.iteration(False)
                time.sleep(0.01)
            self.assertIsNotNone(first.child_pid)
            self.assertIsNotNone(second.child_pid)
            window.notebook.set_current_page(0)
            self.assertEqual(window.get_title(), f"{first.label.get_text()} — terminal")
            self.assertIs(window.get_focus(), first.terminal)
            window.notebook.set_current_page(1)
            self.assertEqual(window.get_title(), f"{second.label.get_text()} — terminal")
            self.assertIs(window.get_focus(), second.terminal)
            first.terminal.feed(b"\x1b]0;background-output\x07")
            deadline = time.monotonic() + 0.15
            while time.monotonic() < deadline:
                while context.pending():
                    context.iteration(False)
                time.sleep(0.01)
            self.assertEqual(window.get_title(), f"{second.label.get_text()} — terminal")
            self.assertIs(window.get_focus(), second.terminal)
            first.terminal.feed_child(b"exit\n")
            deadline = time.monotonic() + 8
            while first.running and time.monotonic() < deadline:
                while context.pending():
                    context.iteration(False)
                time.sleep(0.01)
            self.assertFalse(first.running)
            self.assertTrue(first.label.get_text().startswith("已退出"))
            self.assertIn("已退出", first.label.get_tooltip_text())
        finally:
            window.destroy()

    def test_shell_accepts_input_and_produces_output(self):
        Gtk.init_check()
        if Gdk.Display.get_default() is None:
            self.skipTest("A desktop display is required")
        app = TerminalApplication()
        app.set_flags(Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        window = None
        try:
            window = TerminalWindow(app)
            window.present()
            tab = window.active_tab()
            context = GLib.MainContext.default()

            def wait_for(predicate):
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    while context.pending():
                        context.iteration(False)
                    if predicate():
                        return True
                    time.sleep(0.02)
                return False

            self.assertTrue(wait_for(lambda: tab.child_pid is not None), "Shell did not start")
            tab.terminal.feed_child(b"printf 'LIVE_%s\\n' 'TERMINAL_OK'\n")
            self.assertTrue(
                wait_for(lambda: "LIVE_TERMINAL_OK" in (tab.terminal.get_text_format(Vte.Format.TEXT) or "")),
                "The shell did not execute the command",
            )
            window.settings = Settings(profile="Basic")
            window.apply_chrome()
            self.assertTrue(window.has_css_class("profile-basic"))
            self.assertFalse(window.has_css_class("profile-pro"))
            window.new_tab()
            self.assertEqual(window.notebook.get_n_pages(), 2)
            second = window.active_tab()
            self.assertTrue(wait_for(lambda: second.child_pid is not None))
        finally:
            if window is not None:
                window.destroy()


if __name__ == "__main__":
    unittest.main()
