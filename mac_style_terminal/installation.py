"""Install and remove this checkout's per-user desktop launcher."""

import configparser
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET


ENTRY_NAME = "io.github.macstyle.Terminal.desktop"
ICON_NAME = "io.github.macstyle.Terminal"


def _icon_path(data_home: Path) -> Path:
    return data_home / "icons/hicolor/scalable/apps" / f"{ICON_NAME}.svg"


def _owned_icon(path: Path) -> bool:
    try:
        root = ET.parse(path).getroot()
        return root.tag == "{http://www.w3.org/2000/svg}svg" and root.get("data-mac-style-terminal-managed") == "true"
    except (OSError, ET.ParseError):
        return False


def _data_home() -> Path:
    configured = os.environ.get("XDG_DATA_HOME", "")
    return Path(configured) if configured and Path(configured).is_absolute() else Path.home() / ".local/share"


def _owned(path: Path) -> bool:
    parser = configparser.ConfigParser(interpolation=None)
    try:
        parser.read_string(path.read_text(encoding="utf-8"))
        entry = parser["Desktop Entry"]
        if entry.get("X-MacStyleTerminal-Managed") == "true":
            return True
        # Recognize entries written by the original installer as well.
        command = shlex.split(entry.get("Exec", ""))
        legacy_launcher = Path(__file__).resolve().parents[1] / "bin/mac-style-terminal"
        return (entry.get("Name") == "Mac Style Terminal" and entry.get("Type") == "Application"
                and len(command) == 1 and Path(command[0]).resolve() == legacy_launcher)
    except (OSError, UnicodeError, configparser.Error, KeyError, ValueError):
        return False


def _desktop_command(path: Path) -> str:
    value = str(path)
    if any(character in value for character in "\n\r\x00"):
        raise ValueError("项目路径包含桌面启动器不支持的字符。")
    value = value.replace("%", "%%")
    value = "".join("\\" + character if character in '\\"`$' else character for character in value)
    # Desktop Entry string escaping precedes Exec argument unquoting.
    return '"' + value.replace("\\", "\\\\") + '"'


def check_runtime() -> None:
    code = (
        "import sys; assert sys.version_info >= (3, 10); import gi; "
        "gi.require_version('Gtk', '4.0'); gi.require_version('Vte', '3.91'); "
        "from gi.repository import Gtk, Vte; "
        "assert (Gtk.MAJOR_VERSION, Gtk.MINOR_VERSION) >= (4, 10)"
    )
    result = subprocess.run(["/usr/bin/python3", "-c", code], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("运行依赖缺失。请在 Debian 13 安装 python3-gi、gir1.2-gtk-4.0 和 gir1.2-vte-3.91。")


def _refresh_database(applications: Path) -> None:
    program = shutil.which("update-desktop-database")
    if program:
        subprocess.run([program, str(applications)], capture_output=True, check=False)
    icon_cache = shutil.which("gtk4-update-icon-cache") or shutil.which("gtk-update-icon-cache")
    icon_theme = applications.parent / "icons/hicolor"
    if icon_cache and icon_theme.is_dir():
        subprocess.run([icon_cache, "--force", "--ignore-theme-index", str(icon_theme)], capture_output=True, check=False)


def install_launcher(root: Path, data_home: Path | None = None) -> Path:
    root = root.resolve()
    launcher = root / "bin/mac-style-terminal"
    source_icon = root / "mac_style_terminal/icons" / f"{ICON_NAME}.svg"
    for relative in ("bin/mac-style-terminal", "packaging/mac-style-terminal.desktop", "mac_style_terminal/__main__.py", "mac_style_terminal/style.css", "mac_style_terminal/prompt.bash"):
        if not (root / relative).is_file():
            raise FileNotFoundError(f"项目文件缺失：{relative}")
    if not os.access(launcher, os.X_OK):
        raise PermissionError("bin/mac-style-terminal 没有执行权限。")
    if not source_icon.is_file() or not _owned_icon(source_icon):
        raise FileNotFoundError("项目桌面图标缺失或无效。")
    data_home = data_home or _data_home()
    destination = data_home / "applications" / ENTRY_NAME
    icon = _icon_path(data_home)
    if destination.exists() and not _owned(destination):
        raise FileExistsError("同名桌面入口属于其他应用，安装已停止。")
    if icon.exists() and not _owned_icon(icon):
        raise FileExistsError("同名桌面图标属于其他应用，安装已停止。")
    check_runtime()
    template = (root / "packaging/mac-style-terminal.desktop").read_text(encoding="utf-8")
    content = template.replace("@APP_COMMAND@", _desktop_command(launcher))
    if "X-MacStyleTerminal-Managed=true" not in content:
        content = content.rstrip() + "\nX-MacStyleTerminal-Managed=true\n"
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    temporary_icon = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=destination.parent,
                                         prefix=".mac-style-", suffix=".desktop", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            os.chmod(temporary, 0o644)
        validator = shutil.which("desktop-file-validate")
        if validator:
            result = subprocess.run([validator, str(temporary)], capture_output=True, text=True)
            if result.returncode:
                raise ValueError(f"桌面入口校验失败：{result.stderr or result.stdout}")
        icon.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("wb", dir=icon.parent, prefix=".mac-style-", suffix=".svg", delete=False) as stream:
            temporary_icon = Path(stream.name)
            stream.write(source_icon.read_bytes())
            os.chmod(temporary_icon, 0o644)
        os.replace(temporary_icon, icon)
        os.replace(temporary, destination)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
        if temporary_icon:
            temporary_icon.unlink(missing_ok=True)
    _refresh_database(destination.parent)
    return destination


def uninstall_launcher(data_home: Path | None = None) -> bool:
    data_home = data_home or _data_home()
    destination = data_home / "applications" / ENTRY_NAME
    icon = _icon_path(data_home)
    if destination.exists() and not _owned(destination):
        raise ValueError("无法确认同名桌面入口属于本项目，卸载已停止。")
    removed = False
    if destination.exists():
        destination.unlink()
        removed = True
    if icon.exists() and _owned_icon(icon):
        icon.unlink()
        removed = True
    if removed:
        _refresh_database(destination.parent)
    return removed
