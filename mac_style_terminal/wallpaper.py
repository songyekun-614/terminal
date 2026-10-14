"""Owned wallpaper files and a background layer underneath terminal content."""

from pathlib import Path
import shutil
import uuid
import re

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, GLib, Gtk

from .settings import config_path


def load_wallpaper(path: str | None):
    if not path:
        return None
    try:
        return Gdk.Texture.new_from_filename(path)
    except (GLib.Error, OSError):
        return None


def import_wallpaper(path: str) -> str:
    source = Path(path).resolve()
    if load_wallpaper(str(source)) is None:
        raise ValueError("无法读取这张图片，请选择支持的图片文件。")
    root = (config_path().parent / "wallpapers").resolve()
    if source.is_relative_to(root):
        return str(source)
    folder = root / uuid.uuid4().hex
    folder.mkdir(parents=True)
    destination = folder / source.name
    try:
        shutil.copy2(source, destination)
    except OSError:
        shutil.rmtree(folder)
        raise
    return str(destination)


def remove_wallpaper_copy(path: str | None) -> None:
    if not path:
        return
    file = Path(path).resolve()
    root = (config_path().parent / "wallpapers").resolve()
    if file.parent.parent != root or not re.fullmatch(r"[0-9a-f]{32}", file.parent.name):
        return
    try:
        file.unlink(missing_ok=True)
        file.parent.rmdir()
    except OSError:
        pass


class WallpaperSurface(Gtk.Overlay):
    def __init__(self, content):
        super().__init__()
        self.base = Gtk.Box(css_classes=["wallpaper-base"])
        self.base.set_hexpand(True)
        self.base.set_vexpand(True)
        self.set_child(self.base)
        self._css = Gtk.CssProvider()
        self.base.get_style_context().add_provider(self._css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1)
        self.picture = Gtk.Picture()
        self.picture.set_content_fit(Gtk.ContentFit.COVER)
        self.picture.set_can_target(False)
        self.picture.set_focusable(False)
        self.picture.update_state([Gtk.AccessibleState.HIDDEN], [True])
        self.picture.set_hexpand(True)
        self.picture.set_vexpand(True)
        self.add_overlay(self.picture)
        self.set_measure_overlay(self.picture, False)
        self.set_clip_overlay(self.picture, True)
        self.add_overlay(content)
        self.set_measure_overlay(content, True)

    def update(self, texture, opacity: float, background: str):
        self._css.load_from_string(f".wallpaper-base {{ background-color: {background}; }}")
        self.picture.set_paintable(texture)
        self.picture.set_opacity(opacity)
        self.picture.set_visible(texture is not None)
