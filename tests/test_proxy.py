import json
from pathlib import Path
import subprocess
import unittest

from mac_style_terminal.proxy import proxy_environment


class ProxyTests(unittest.TestCase):
    def test_child_environment(self):
        cases = json.loads(Path(__file__).with_name("proxy-cases.json").read_text())
        for case in cases:
            with self.subTest(case=case["name"]):
                original = dict(case["env"])
                self.assertEqual(proxy_environment(original, read=lambda: case["settings"]), case["want"])
                self.assertEqual(original, case["env"])

    def test_unavailable_desktop_settings_do_not_break_shell_startup(self):
        def unavailable():
            raise FileNotFoundError("gsettings")
        self.assertEqual(proxy_environment({"PATH": "/bin"}, read=unavailable), {"PATH": "/bin"})

    def test_settings_timeout_does_not_break_shell_startup(self):
        def timeout():
            raise subprocess.TimeoutExpired("gsettings", 1)
        self.assertEqual(proxy_environment({}, read=timeout), {})
