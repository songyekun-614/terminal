"""Translate Linux desktop manual proxies for command-line child processes."""

import os
import re
import subprocess
import sys
from urllib.parse import urlsplit


def _read_gnome_proxy() -> str:
    return subprocess.check_output(
        ["gsettings", "list-recursively", "org.gnome.system.proxy"],
        text=True, timeout=1, stderr=subprocess.DEVNULL,
    )


def proxy_environment(environment=None, read=_read_gnome_proxy) -> dict[str, str]:
    env = dict(os.environ if environment is None else environment)
    if sys.platform != "linux":
        return env

    def inherit(name, fallback=None):
        upper = name.upper()
        value = env.get(name, env.get(upper, fallback))
        if value is not None:
            env.setdefault(name, value)
            env.setdefault(upper, value)

    for name in ("http_proxy", "https_proxy", "all_proxy", "no_proxy"):
        inherit(name)
    if "all_proxy" in env:
        return env
    try:
        values = {}
        for line in read().splitlines():
            match = re.fullmatch(r"org\.gnome\.system\.proxy(\.[a-z]+)?\s+(\S+)\s+(.+)", line)
            if match:
                values[(match[1] or "") + "." + match[2]] = match[3].strip()

        def string(key):
            raw = values.get(key, "")
            return raw[1:-1] if re.fullmatch(r'''(['"])[^'"\\]*\1''', raw) else ""

        if string(".mode") != "manual":
            return env

        def endpoint(name, scheme="http"):
            host = string(f".{name}.host")
            raw_port = values.get(f".{name}.port", "")
            if not re.fullmatch(r"[a-zA-Z0-9._:\[\]-]+", host) or not raw_port.isdigit():
                return None
            port = int(raw_port)
            if not 1 <= port <= 65535:
                return None
            address = f"[{host}]" if ":" in host and not host.startswith("[") else host
            value = f"{scheme}://{address}:{port}"
            try:
                urlsplit(value).port
            except ValueError:
                return None
            return value

        # Desktop credentials must not be copied into shell environments.
        http = None if values.get(".http.use-authentication") == "true" else endpoint("http")
        https = endpoint("https") or http
        socks = endpoint("socks", "socks5h")
        inherit("http_proxy", http)
        inherit("https_proxy", https)
        inherit("all_proxy", socks)
        if http or https or socks:
            bypass = [re.sub(r"^\*\.", ".", host) for host in re.findall(r'''['"]([^'"\\]*)['"]''', values.get(".ignore-hosts", ""))]
            inherit("no_proxy", ",".join(host for host in bypass if re.fullmatch(r"[a-zA-Z0-9._:/\[\]-]+", host)))
    except (OSError, subprocess.SubprocessError):
        # Missing tools/schemas and settings timeouts must not prevent shell startup.
        pass
    return env
