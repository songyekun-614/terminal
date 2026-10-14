"""Resolve local shell and working-directory choices for new tabs."""

import os
from pathlib import Path
from urllib.parse import unquote, urlparse


def choose_shell() -> str:
    candidate = os.environ.get("SHELL", "")
    if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
        return candidate
    return "/bin/sh"


def shell_command(shell: str) -> list[str]:
    if Path(shell).resolve().name == "bash":
        return [shell, "--rcfile", str(Path(__file__).with_name("prompt.bash"))]
    return [shell]


def directory_from_uri(uri: str | None) -> Path:
    if uri:
        parsed = urlparse(uri)
        if parsed.scheme == "file" and parsed.netloc in ("", "localhost"):
            candidate = Path(unquote(parsed.path))
            if candidate.is_dir():
                return candidate
    return Path.home()


def directory_from_session(uri: str | None, pid: int | None) -> Path:
    """Use OSC 7's directory, then Linux procfs when the shell omits it."""
    if uri:
        parsed = urlparse(uri)
        if parsed.scheme == "file" and parsed.netloc in ("", "localhost"):
            candidate = Path(unquote(parsed.path))
            if candidate.is_dir():
                return candidate
    if pid and pid > 0:
        try:
            candidate = Path(os.readlink(f"/proc/{pid}/cwd"))
            if candidate.is_dir():
                return candidate
        except OSError:
            pass
    return Path.home()
