"""Persist the small set of terminal appearance preferences."""

from dataclasses import asdict, dataclass
import json
import os
import re
from pathlib import Path
import tempfile


PROFILES = {
    "Pro": {"background": "#17191e", "foreground": "#f2f2f4", "cursor": "#d2d4da"},
    "Basic": {"background": "#faf9f7", "foreground": "#242528", "cursor": "#27282a"},
    "Homebrew": {"background": "#101814", "foreground": "#b9f1cb", "cursor": "#8ce2aa"},
}

BACKGROUND_PRESETS = {
    "石墨灰": "#17191e", "午夜蓝": "#121e32", "森林绿": "#13251c",
    "暖棕": "#2b211e", "酒红": "#2d1b24", "深青": "#10282a",
    "暖白": "#faf9f7", "浅灰": "#eceff3", "浅蓝": "#e7f0fa", "淡绿": "#e8f2eb",
}

USERNAME_COLOR_PRESETS = {
    "绿色": "#28c840", "蓝色": "#5b9dff", "青色": "#2ec7c9",
    "橙色": "#f2a65a", "粉色": "#e783b2",
}


def normalize_background(value) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip().lower()
    if re.fullmatch(r"#[0-9a-f]{3}", value):
        value = "#" + "".join(character * 2 for character in value[1:])
    return value if re.fullmatch(r"#[0-9a-f]{6}", value) else None


def _luminance(color: str) -> float:
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels]
    return sum(channel * weight for channel, weight in zip(linear, (0.2126, 0.7152, 0.0722)))


def terminal_palette(settings) -> dict[str, str]:
    palette = PROFILES[settings.profile].copy()
    background = normalize_background(settings.background)
    if background:
        palette["background"] = background
        light = _luminance(background)
        foreground = _luminance(palette["foreground"])
        contrast = (max(light, foreground) + 0.05) / (min(light, foreground) + 0.05)
        if contrast < 4.5:
            candidates = ("#242528", "#f2f2f4")
            def ratio(color):
                foreground = _luminance(color)
                return (max(light, foreground) + 0.05) / (min(light, foreground) + 0.05)
            palette["foreground"] = max(candidates, key=ratio)
            if ratio(palette["foreground"]) < 4.5:
                palette["foreground"] = max(("#000000", "#ffffff"), key=ratio)
        palette["cursor"] = palette["foreground"]
    return palette


@dataclass(frozen=True)
class Settings:
    profile: str = "Pro"
    font_family: str = "Monospace"
    font_size: int = 12
    background: str | None = None
    wallpaper: str | None = None
    wallpaper_opacity: float = 0.35
    username_color: str = "#28c840"


def config_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME")
    root = Path(base) if base else Path.home() / ".config"
    return root / "mac-style-terminal" / "settings.json"


def load_settings(path: Path | None = None) -> Settings:
    path = path or config_path()
    try:
        values = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
        return Settings()
    if not isinstance(values, dict):
        return Settings()
    profile = values.get("profile")
    family = values.get("font_family")
    size = values.get("font_size")
    wallpaper = values.get("wallpaper")
    opacity = values.get("wallpaper_opacity")
    return Settings(
        profile=profile if isinstance(profile, str) and profile in PROFILES else "Pro",
        font_family=family.strip() if isinstance(family, str) and family.strip() and len(family) <= 100 else "Monospace",
        font_size=size if isinstance(size, int) and not isinstance(size, bool) and 8 <= size <= 32 else 12,
        background=normalize_background(values.get("background")),
        wallpaper=wallpaper if isinstance(wallpaper, str) and len(wallpaper) <= 4096 and Path(wallpaper).is_absolute() else None,
        wallpaper_opacity=float(opacity) if isinstance(opacity, (int, float)) and not isinstance(opacity, bool) and 0 <= opacity <= 1 else 0.35,
        username_color=normalize_background(values.get("username_color")) or "#28c840",
    )


def save_settings(settings: Settings, path: Path | None = None) -> None:
    path = path or config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=".settings-", delete=False) as stream:
            temporary = Path(stream.name)
            os.chmod(temporary, 0o600)
            json.dump(asdict(settings), stream, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
