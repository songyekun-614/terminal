import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import shutil
import time
from unittest.mock import patch

from gi.repository import Gio
from mac_style_terminal.installation import install_launcher, uninstall_launcher


ROOT = Path(__file__).resolve().parents[1]


class LauncherTests(unittest.TestCase):
    def test_install_uninstall_reinstall_preserve_configuration_and_other_apps(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}):
            data = Path(directory) / "data"
            os.environ["XDG_CONFIG_HOME"] = str(Path(directory) / "config")
            config = Path(directory) / "config/mac-style-terminal"
            config.mkdir(parents=True)
            settings = config / "settings.json"
            settings.write_text("keep my settings")
            applications = data / "applications"
            applications.mkdir(parents=True)
            other = applications / "other.desktop"
            other.write_text("another application")
            entry = install_launcher(ROOT, data)
            icon = data / "icons/hicolor/scalable/apps/io.github.macstyle.Terminal.svg"
            self.assertTrue(icon.is_file())
            self.assertEqual(Gio.DesktopAppInfo.new_from_filename(str(entry)).get_name(), "terminal")
            self.assertEqual(Gio.DesktopAppInfo.new_from_filename(str(entry)).get_icon().to_string(), "io.github.macstyle.Terminal")
            self.assertEqual(entry.stat().st_mode & 0o777, 0o644)
            install_launcher(ROOT, data)
            self.assertTrue(uninstall_launcher(data))
            self.assertFalse(uninstall_launcher(data))
            self.assertFalse(entry.exists())
            self.assertFalse(icon.exists())
            self.assertEqual(settings.read_text(), "keep my settings")
            self.assertEqual(other.read_text(), "another application")
            self.assertTrue(install_launcher(ROOT, data).exists())

    def test_cli_removes_legacy_entry_and_repeated_uninstall_succeeds(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, "XDG_DATA_HOME": str(Path(directory) / "data"),
                   "XDG_CONFIG_HOME": str(Path(directory) / "config")}
            entry = Path(env["XDG_DATA_HOME"]) / "applications/io.github.macstyle.Terminal.desktop"
            entry.parent.mkdir(parents=True)
            entry.write_text(f"[Desktop Entry]\nType=Application\nName=Mac Style Terminal\nExec={ROOT}/bin/mac-style-terminal\n")
            for script in ("uninstall-launcher", "install-launcher", "uninstall-launcher", "uninstall-launcher"):
                result = subprocess.run([sys.executable, str(ROOT / "bin" / script)], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(entry.exists())

    def test_foreign_entry_is_not_overwritten_or_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            entry = data / "applications/io.github.macstyle.Terminal.desktop"
            entry.parent.mkdir()
            for name, command in (("Other app", "/bin/true"), ("Mac Style Terminal", "/opt/other/bin/mac-style-terminal")):
                content = f"[Desktop Entry]\nType=Application\nName={name}\nExec={command}\n"
                entry.write_text(content)
                with self.assertRaises(FileExistsError):
                    install_launcher(ROOT, data)
                with self.assertRaises(ValueError):
                    uninstall_launcher(data)
                self.assertEqual(entry.read_text(), content)

    def test_foreign_icon_is_not_overwritten_or_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            icon = data / "icons/hicolor/scalable/apps/io.github.macstyle.Terminal.svg"
            icon.parent.mkdir(parents=True)
            icon.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
            with self.assertRaises(FileExistsError):
                install_launcher(ROOT, data)
            self.assertFalse((data / "applications/io.github.macstyle.Terminal.desktop").exists())
            self.assertFalse(uninstall_launcher(data))
            self.assertTrue(icon.is_file())

    def test_desktop_launch_handles_spaces_unicode_and_reserved_characters(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / '项目 空格 $ ` % " \\ ='
            shutil.copytree(ROOT, project, ignore=shutil.ignore_patterns(".git", "__pycache__", "tests", "docs"))
            launcher = project / "bin/mac-style-terminal"
            launcher.write_text("#!/bin/sh\nexec /usr/bin/python3 - \"$0\" <<'PY'\nfrom pathlib import Path\nimport sys\nPath(sys.argv[1]).with_name('launched').write_text('OK')\nPY\n")
            launcher.chmod(0o755)
            entry = install_launcher(project, Path(directory) / "data")
            app = Gio.DesktopAppInfo.new_from_filename(str(entry))
            self.assertIsNotNone(app)
            self.assertTrue(app.launch([], None))
            marker = launcher.with_name("launched")
            deadline = time.monotonic() + 3
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(marker.read_text(), "OK")

    def test_installed_desktop_entry_points_at_this_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, "XDG_DATA_HOME": directory}
            subprocess.run([sys.executable, str(ROOT / "bin/install-launcher")], env=env, check=True)
            installed = Path(directory) / "applications/io.github.macstyle.Terminal.desktop"
            content = installed.read_text(encoding="utf-8")
            self.assertIn(str(ROOT / "bin/mac-style-terminal"), content)
            self.assertNotIn("@APP_DIR@", content)


if __name__ == "__main__":
    unittest.main()
