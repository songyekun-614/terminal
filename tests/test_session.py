import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from mac_style_terminal.session import choose_shell, directory_from_session, directory_from_uri


class SessionTests(unittest.TestCase):
    def test_uses_executable_shell(self):
        with patch.dict(os.environ, {"SHELL": "/bin/sh"}):
            self.assertEqual(choose_shell(), "/bin/sh")

    def test_falls_back_when_shell_missing(self):
        with patch.dict(os.environ, {"SHELL": "/missing/shell"}):
            self.assertEqual(choose_shell(), "/bin/sh")

    def test_local_uri_becomes_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(directory_from_uri(Path(directory).as_uri()), Path(directory))

    def test_remote_or_invalid_uri_uses_home(self):
        self.assertEqual(directory_from_uri("sftp://example.com/home"), Path.home())
        self.assertEqual(directory_from_uri("file:///missing/path"), Path.home())
        self.assertEqual(directory_from_uri(None), Path.home())

    def test_running_local_process_directory_is_used_without_shell_uri(self):
        self.assertEqual(directory_from_session(None, os.getpid()), Path.cwd())


if __name__ == "__main__":
    unittest.main()
