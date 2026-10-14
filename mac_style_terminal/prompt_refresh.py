"""Recolor the visible idle prompt without sending input to its shell."""

from html.parser import HTMLParser
import os
import pwd
import re
import socket

from gi.repository import GLib, GObject, Vte


PROMPT_IDLE = "vte.ext.macstyle.prompt-idle"
# Initialize built-in IDs before registering ours, with no Terminal instances yet.
_terminal_class = GObject.type_class_ref(Vte.Terminal.__gtype__)
if not Vte.query_termprop(PROMPT_IDLE)[0]:
    Vte.install_termprop(PROMPT_IDLE, Vte.PropertyType.BOOL, Vte.PropertyFlags.NONE)


class _StyledRow(HTMLParser):
    def __init__(self, markup):
        super().__init__(convert_charrefs=True)
        self.text = ""
        self.styles = []
        self.colors = [None]
        self.bold = 0
        self.feed(markup)

    def handle_starttag(self, tag, attrs):
        if tag == "font":
            self.colors.append(dict(attrs).get("color", self.colors[-1]))
        elif tag == "b":
            self.bold += 1

    def handle_endtag(self, tag):
        if tag == "font" and len(self.colors) > 1:
            self.colors.pop()
        elif tag == "b":
            self.bold = max(0, self.bold - 1)

    def handle_data(self, text):
        self.text += text
        self.styles.extend([(self.colors[-1], bool(self.bold))] * len(text))


class PromptColorRefresh:
    def __init__(self, terminal, tab):
        self.terminal, self.tab = terminal, tab
        self.color = tab.window.settings.username_color.upper()
        self.previous_colors = {self.color}
        self.enabled = False
        self.source = 0
        self.prompt_row = None
        username = pwd.getpwuid(os.getuid()).pw_name
        hostname = socket.gethostname()
        hosts = sorted({hostname, hostname.split(".")[0]}, key=len, reverse=True)
        self.names = re.compile(re.escape(username) + "@(?:" + "|".join(re.escape(host) for host in hosts) + ")")
        terminal.connect("contents-changed", self.schedule)
        terminal.connect("map", self.schedule)
        terminal.connect("unmap", self.cancel)
        terminal.connect("unrealize", self.cancel)
        terminal.connect("termprop-changed", self.prompt_state_changed)

    def prompt_state_changed(self, terminal, name):
        if name != PROMPT_IDLE:
            return
        available, idle = terminal.get_termprop_bool(PROMPT_IDLE)
        self.prompt_row = terminal.get_cursor_position().row if available and idle else None
        self.schedule()

    def column_for_prefix(self, row, prefix):
        low, high = 0, self.terminal.get_column_count()
        while low < high:
            middle = (low + high) // 2
            text, _length = self.terminal.get_text_range_format(Vte.Format.TEXT, row, 0, row, middle)
            if len(text or "") < len(prefix):
                low = middle + 1
            else:
                high = middle
        text, _length = self.terminal.get_text_range_format(Vte.Format.TEXT, row, 0, row, low)
        return low if (text or "") == prefix else None

    def set_color(self, color):
        color = color.upper()
        if color != self.color:
            self.previous_colors.add(self.color)
            self.previous_colors.add(color)
            self.color = color
            self.enabled = True
            self.schedule()

    def cancel(self, *_args):
        if self.source:
            GLib.source_remove(self.source)
            self.source = 0

    def schedule(self, *_args):
        if self.enabled and self.terminal.get_mapped() and not self.source:
            self.source = GLib.idle_add(self.refresh)

    def refresh(self):
        self.source = 0
        terminal = self.terminal
        if not terminal.get_mapped() or not self.tab.running or not self.tab.child_pid or self.prompt_row is None:
            return False
        pty = terminal.get_pty()
        try:
            if pty is None or os.tcgetpgrp(pty.get_fd()) != self.tab.child_pid:
                return False
        except OSError:
            return False
        adjustment = terminal.get_vadjustment()
        if adjustment.get_value() + adjustment.get_page_size() < adjustment.get_upper():
            return False
        top = max(0, int(adjustment.get_upper()) - terminal.get_row_count())
        column, cursor_row = terminal.get_cursor_position()
        for row in range(cursor_row, max(top, self.prompt_row) - 1, -1):
            markup, _length = terminal.get_text_range_format(Vte.Format.HTML, row, 0, row, terminal.get_column_count() - 1)
            styled = _StyledRow(markup or "")
            for match in reversed(list(self.names.finditer(styled.text))):
                styles = styled.styles[match.start():match.end()]
                if not styles or len(set(styles)) != 1:
                    continue
                old_color, bold = styles[0]
                if old_color not in self.previous_colors:
                    continue
                if old_color == self.color:
                    return False
                start_column = self.column_for_prefix(row, styled.text[:match.start()])
                if start_column is None or (row == cursor_row and start_column >= column):
                    continue
                red, green, blue = (int(self.color[index:index + 2], 16) for index in (1, 3, 5))
                # Feed only display bytes. DECSC/DECRC preserve cursor and SGR state.
                paint = (f"\x1b7\x1b[{row - top + 1};{start_column + 1}H"
                         f"\x1b[{1 if bold else 22};38;2;{red};{green};{blue}m"
                         f"{match.group()}\x1b8")
                terminal.feed(paint.encode())
                return False
        return False
