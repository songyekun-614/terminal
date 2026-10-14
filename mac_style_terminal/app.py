"""GTK window and VTE sessions for Mac Style Terminal."""

from __future__ import annotations

from pathlib import Path
import re

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("Vte", "3.91")
from gi.repository import Gdk, Gio, GLib, Gtk, Pango, Vte

from .session import choose_shell, directory_from_session, shell_command
from .settings import BACKGROUND_PRESETS, PROFILES, USERNAME_COLOR_PRESETS, Settings, config_path, load_settings, normalize_background, save_settings, terminal_palette
from .transitions import PopupReveal, TabTransition
from .wallpaper import WallpaperSurface, import_wallpaper, load_wallpaper, remove_wallpaper_copy
from .prompt_refresh import PromptColorRefresh
from .installation import ICON_NAME
from . import APP_NAME

HEADER_TITLE = "Stay focused"
HEADER_SUBTITLE = "Start with a command"


def tab_title(title: str | None, index: int) -> str:
    text = title.strip() if title else ""
    return text[:31] + "…" if len(text) > 32 else (text or f"{APP_NAME} {index}")


def adjusted_font_size(current: int, saved: int, amount: int) -> int:
    return saved if amount == 0 else max(8, min(32, current + amount))


def rgba(value: str) -> Gdk.RGBA:
    color = Gdk.RGBA()
    color.parse(value)
    return color


class TerminalTab:
    def __init__(self, window: "TerminalWindow", index: int, directory: Path):
        self.window = window
        self.index = index
        self.directory = directory
        self.display_directory = directory
        self.running = False
        self.exited = False
        self.custom_title: str | None = None
        self.shell_title: str | None = None
        self.child_pid: int | None = None
        self.terminal = Vte.Terminal()
        self.terminal.set_hexpand(True)
        self.terminal.set_vexpand(True)
        self.terminal.set_scrollback_lines(10000)
        self.terminal.set_mouse_autohide(True)
        self.terminal.set_allow_hyperlink(True)
        self.terminal.connect("window-title-changed", self._title_changed)
        self.terminal.connect("child-exited", self._child_exited)
        window.apply_settings(self.terminal)
        self.prompt_refresh = PromptColorRefresh(self.terminal, self)

        self.page = Gtk.Overlay()
        self.page.add_css_class("terminal-page")
        self.page.set_overflow(Gtk.Overflow.HIDDEN)
        self.page.connect("unmap", lambda page: window.tab_transition.stop_for(page))
        self.page.set_hexpand(True)
        self.page.set_vexpand(True)
        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.background_surface = WallpaperSurface(content)
        self.background_surface.update(window._wallpaper_texture, window.settings.wallpaper_opacity, terminal_palette(window.settings)["background"])
        self.page.set_child(self.background_surface)
        scroll = Gtk.ScrolledWindow()
        scroll.set_child(self.terminal)
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroll.set_hexpand(True)
        scroll.set_vexpand(True)
        scroll.set_margin_start(20)
        scroll.set_margin_end(16)
        scroll.set_margin_top(18)
        scroll.set_margin_bottom(18)
        content.append(scroll)
        self.retry_button = Gtk.Button(label="Retry shell")
        self.retry_button.set_halign(Gtk.Align.CENTER)
        self.retry_button.set_margin_top(10)
        self.retry_button.set_margin_bottom(10)
        self.retry_button.set_visible(False)
        self.retry_button.connect("clicked", lambda _button: self.spawn())
        content.append(self.retry_button)

        label_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=4)
        label_box.add_css_class("tab-label")
        label_box.set_hexpand(False)
        self.label = Gtk.Label(label=tab_title(None, index))
        self.label.set_tooltip_text(self.label.get_text())
        self.label.set_ellipsize(Pango.EllipsizeMode.END)
        self.label.set_xalign(0)
        self.label.set_hexpand(False)
        self.label.connect("map", lambda _label: self._update_caption_width())
        self.label.connect("notify::scale-factor", lambda *_args: self._update_caption_width())
        rename_gesture = Gtk.GestureClick()
        rename_gesture.set_button(1)
        rename_gesture.connect("pressed", lambda _gesture, count, _x, _y: window.rename_tab(self) if count == 2 else None)
        self.label.add_controller(rename_gesture)
        self._update_caption_width()
        close_button = Gtk.Button(icon_name="window-close-symbolic")
        close_button.get_child().set_pixel_size(12)
        close_button.set_valign(Gtk.Align.CENTER)
        close_button.add_css_class("flat")
        close_button.add_css_class("tab-close")
        close_button.set_tooltip_text("关闭标签页")
        close_button.update_property([Gtk.AccessibleProperty.LABEL], ["关闭标签页"])
        close_button.connect("clicked", lambda _button: window.request_close_tab(self))
        label_box.append(self.label)
        label_box.append(close_button)
        window.notebook.append_page(self.page, label_box)
        window.notebook.set_tab_reorderable(self.page, True)
        window.notebook.set_current_page(window.notebook.page_num(self.page))
        self.spawn()

    def spawn(self) -> None:
        shell = choose_shell()
        self.running = True
        self.exited = False
        self._refresh_caption()
        self.retry_button.set_visible(False)
        environment = GLib.environ_setenv(GLib.get_environ(), "TERM", "xterm-256color", True)
        environment = GLib.environ_setenv(environment, "MAC_STYLE_TERMINAL_SETTINGS", str(config_path().absolute()), True)
        # Debian's binding exposes child_setup_data before timeout.
        # Describe VTE's capabilities instead of inheriting a launcher TERM=dumb.
        self.terminal.spawn_async(
            Vte.PtyFlags.DEFAULT,
            str(self.directory),
            shell_command(shell),
            environment,
            GLib.SpawnFlags.DEFAULT,
            None,
            None,
            -1,
            None,
            self._spawn_done,
            None,
        )
        self.terminal.grab_focus()

    def _spawn_done(self, _terminal, pid, error, *_data) -> None:
        if error:
            self.running = False
            self.retry_button.set_visible(True)
            self.terminal.feed(f"\r\nCould not start shell: {error}\r\n".encode())
            self.window.show_error(f"Could not start shell: {error}")
        else:
            self.child_pid = pid
            if self.window.active_tab() is self:
                self.window.queue_title_update()

    def _title_changed(self, terminal: Vte.Terminal) -> None:
        self.shell_title, _size = terminal.get_termprop_string(Vte.TERMPROP_XTERM_TITLE)
        self._refresh_caption()
        if self.window.active_tab() is self:
            self.window.queue_title_update()

    def _refresh_caption(self) -> None:
        text = self.custom_title or tab_title(self.shell_title, self.index)
        tooltip = self.custom_title or self.shell_title or text
        if self.exited:
            text = f"已退出 · {text}"
            tooltip = f"已退出 · {tooltip}"
        if self.label.get_tooltip_text() != tooltip:
            self.label.set_tooltip_text(tooltip)
        if self.label.get_text() != text:
            self.label.set_text(text)
            self._update_caption_width()

    def rename(self, name: str) -> None:
        self.custom_title = name.strip() or None
        self._refresh_caption()
        self.window.update_title()

    def _child_exited(self, _terminal: Vte.Terminal, _status: int) -> None:
        self.running = False
        self.exited = True
        self._refresh_caption()
        if self.window.active_tab() is self:
            self.window.queue_title_update()
        self.terminal.feed(b"\r\n[Shell exited. Close this tab or open a new one.]\r\n")

    def _update_caption_width(self) -> None:
        # Measure unellipsized text with the label's font, including wide glyphs.
        width, _height = self.label.create_pango_layout(self.label.get_text()).get_pixel_size()
        self.label.set_size_request(min(width, 160), -1)

    def current_directory(self) -> Path:
        uri = self.terminal.ref_termprop_uri(Vte.TERMPROP_CURRENT_DIRECTORY_URI)
        return directory_from_session(uri.to_string() if uri else None, self.child_pid)


class TerminalWindow(Gtk.ApplicationWindow):
    def __init__(self, app: "TerminalApplication"):
        super().__init__(application=app, title=APP_NAME)
        icon_theme = Gtk.IconTheme.get_for_display(self.get_display())
        icon_path = str(Path(__file__).with_name("icons"))
        if icon_path not in icon_theme.get_search_path():
            icon_theme.add_search_path(icon_path)
        self.set_icon_name(ICON_NAME)
        self.add_css_class("terminal-window")
        self.set_default_size(1040, 680)
        self.set_size_request(550, 340)
        self.settings = load_settings()
        self._wallpaper_path = self.settings.wallpaper
        self._wallpaper_texture = load_wallpaper(self._wallpaper_path)
        self._terminal_css = Gtk.CssProvider()
        self._terminal_css.load_from_string(".transparent-terminal { background-color: transparent; background-image: none; }")
        self._background_class = f"terminal-background-{id(self):x}"
        self.add_css_class(self._background_class)
        self._background_css = Gtk.CssProvider()
        Gtk.StyleContext.add_provider_for_display(self.get_display(), self._background_css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1)
        self.zoom_font_size = self.settings.font_size
        self.next_index = 1
        self.tabs: dict[Gtk.Widget, TerminalTab] = {}
        self._allow_close = False
        self._title_update_source = 0
        self._shell_name = Path(choose_shell()).name
        self.tab_transition = TabTransition()
        self._pending_transition = None
        self._motion_warm_source = 0
        self._motion_warm_attempts = 0

        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.set_child(root)
        header = Gtk.HeaderBar()
        header.add_css_class("terminal-header")
        header.set_show_title_buttons(False)
        controls = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=0)
        controls.add_css_class("window-controls")
        for kind, text, action in [
            ("close", "关闭窗口", self.close),
            ("minimize", "最小化", self.minimize),
            ("maximize", "最大化或还原", lambda: self.unmaximize() if self.is_maximized() else self.maximize()),
        ]:
            button = Gtk.Button()
            button.add_css_class("traffic-control")
            button.set_tooltip_text(text)
            button.update_property([Gtk.AccessibleProperty.LABEL], [text])
            dot = Gtk.Box(css_classes=["traffic-dot", kind])
            dot.set_halign(Gtk.Align.CENTER)
            dot.set_valign(Gtk.Align.CENTER)
            symbol = Gtk.Image.new_from_file(str(Path(__file__).parent / "icons" / f"{kind}.svg"))
            symbol.set_pixel_size(16)
            symbol.add_css_class("traffic-symbol")
            symbol.update_state([Gtk.AccessibleState.HIDDEN], [True])
            dot.append(symbol)
            button.set_child(dot)
            button.connect("clicked", lambda _button, run=action: run())
            controls.append(button)
        header.pack_start(controls)
        title = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        title.add_css_class("header-title")
        self.header_title = Gtk.Label(label=HEADER_TITLE, css_classes=["title-label"])
        self.header_subtitle = Gtk.Label(label=HEADER_SUBTITLE, css_classes=["subtitle-label"])
        title.append(self.header_title)
        title.append(self.header_subtitle)
        header.set_title_widget(title)
        self.set_titlebar(header)

        new_button = Gtk.Button(icon_name="tab-new-symbolic")
        new_button.add_css_class("chrome-button")
        new_button.set_tooltip_text("新建标签页 · Ctrl+Shift+T")
        new_button.update_property([Gtk.AccessibleProperty.LABEL], ["新建标签页"])
        new_button.connect("clicked", lambda _button: self.new_tab())

        menu = Gio.Menu()
        terminal_menu = Gio.Menu()
        terminal_menu.append("新建标签页", "win.new-tab")
        terminal_menu.append("重命名标签页", "win.rename-tab")
        terminal_menu.append("查找终端内容", "win.find")
        app_menu = Gio.Menu()
        app_menu.append("外观设置", "win.preferences")
        app_menu.append("关于终端", "win.about")
        menu.append_section("终端操作", terminal_menu)
        menu.append_section("应用设置", app_menu)
        popover = Gtk.PopoverMenu.new_from_model(menu)
        popover.add_css_class("terminal-menu")
        popover.set_has_arrow(False)
        popover.set_halign(Gtk.Align.END)
        popover.set_offset(0, 6)
        menu_button = Gtk.MenuButton(popover=popover)
        menu_button.add_css_class("terminal-menu-button")
        menu_icon = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        menu_icon.set_halign(Gtk.Align.CENTER)
        menu_icon.set_valign(Gtk.Align.CENTER)
        icon = Gtk.Image.new_from_icon_name("open-menu-symbolic")
        icon.set_pixel_size(16)
        arrow = Gtk.Image.new_from_icon_name("pan-down-symbolic")
        arrow.set_pixel_size(10)
        menu_icon.append(icon)
        menu_icon.append(arrow)
        menu_button.set_child(menu_icon)
        menu_button.set_tooltip_text("终端菜单")
        menu_button.update_property([Gtk.AccessibleProperty.LABEL], ["终端菜单"])
        header.pack_end(menu_button)
        header.pack_end(new_button)

        self.notebook = Gtk.Notebook()
        self.notebook.set_scrollable(True)
        self.notebook.set_show_border(False)
        self.notebook.add_css_class("terminal-tabs")
        self._tab_bar_click = Gtk.GestureClick()
        self._tab_bar_click.set_button(1)
        self._tab_bar_click.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        self._tab_bar_click.connect("pressed", self._tab_bar_pressed)
        self.notebook.add_controller(self._tab_bar_click)
        self.notebook.connect("switch-page", self._prepare_switch_page)
        self.notebook.connect_after("switch-page", self._on_switch_page)
        self.notebook.set_hexpand(True)
        self.notebook.set_vexpand(True)
        self.notebook.set_margin_start(10)
        self.notebook.set_margin_end(10)
        self.notebook.set_margin_bottom(10)
        root.append(self.notebook)
        self.connect("close-request", self._close_requested)
        self.connect("unrealize", self._cancel_title_update)
        self.connect("map", self._schedule_motion_warmup)
        self._install_actions(app)
        self.new_tab()
        self.apply_chrome()

    def _tab_bar_pressed(self, gesture, count: int, x: float, y: float) -> None:
        if count != 2:
            return
        header = self.notebook.get_first_child()
        target = self.notebook.pick(x, y, Gtk.PickFlags.DEFAULT)
        while target is not None and target is not self.notebook:
            # Exclude the entire tab (including padding) and overflow arrows.
            if target.get_css_name() in {"tab", "button", "arrow"} or target.has_css_class("tab-label"):
                return
            if target is header:
                gesture.set_state(Gtk.EventSequenceState.CLAIMED)
                self.new_tab()
                return
            target = target.get_parent()

    def _install_actions(self, app: "TerminalApplication") -> None:
        shortcuts = {
            "new-tab": (lambda: self.new_tab(), ["<Control><Shift>t"]),
            "rename-tab": (self.rename_tab, ["<Control><Shift>r"]),
            "close-tab": (self.close_current_tab, ["<Control><Shift>w"]),
            "next-tab": (lambda: self.move_tab(1), ["<Control>Page_Down"]),
            "previous-tab": (lambda: self.move_tab(-1), ["<Control>Page_Up"]),
            "copy": (self.copy, ["<Control><Shift>c"]),
            "paste": (self.paste, ["<Control><Shift>v"]),
            "select-all": (self.select_all, ["<Control><Shift>a"]),
            "zoom-in": (lambda: self.zoom(1), ["<Control>plus", "<Control>equal"]),
            "zoom-out": (lambda: self.zoom(-1), ["<Control>minus"]),
            "zoom-reset": (lambda: self.zoom(0), ["<Control>0"]),
            "find": (self.find, ["<Control><Shift>f"]),
            "preferences": (self.preferences, ["<Control>comma"]),
            "about": (self.about, []),
        }
        for name, (callback, keys) in shortcuts.items():
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", lambda _action, _parameter, run=callback: run())
            self.add_action(action)
            if keys:
                app.set_accels_for_action(f"win.{name}", keys)

    def active_tab(self) -> TerminalTab | None:
        page = self.notebook.get_nth_page(self.notebook.get_current_page())
        return self.tabs.get(page)

    def new_tab(self) -> None:
        current = self.active_tab()
        directory = current.current_directory() if current else Path.home()
        tab = TerminalTab(self, self.next_index, directory)
        self.tabs[tab.page] = tab
        self.next_index += 1
        self.update_title()

    def rename_tab(self, tab: TerminalTab | None = None) -> None:
        tab = tab or self.active_tab()
        if tab is None or tab.page not in self.tabs:
            return
        dialog = Gtk.Dialog(title="重命名标签页", transient_for=self, modal=True)
        dialog.add_css_class("terminal-preferences")
        dialog.add_css_class("terminal-rename")
        dialog.add_css_class(f"profile-{self.settings.profile.lower()}")
        dialog.set_default_size(380, -1)
        dialog.set_resizable(False)
        dialog.set_titlebar(Gtk.Box())
        content = dialog.get_content_area()
        body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        for edge in ("start", "end", "top", "bottom"):
            getattr(body, f"set_margin_{edge}")(24)
        title = Gtk.Label(label="重命名标签页", xalign=0, css_classes=["section-title"])
        hint = Gtk.Label(label="设置便于识别的名称，留空则恢复自动标题。", wrap=True, xalign=0, css_classes=["settings-description"])
        entry = Gtk.Entry()
        entry.set_text(tab.custom_title or tab_title(tab.shell_title, tab.index))
        entry.set_placeholder_text("例如：开发服务器")
        entry.set_activates_default(True)
        entry.update_property([Gtk.AccessibleProperty.LABEL], ["标签页名称"])
        for widget in (title, hint, entry):
            body.append(widget)
        content.append(body)
        cancel = dialog.add_button("取消", Gtk.ResponseType.CANCEL)
        save = dialog.add_button("保存", Gtk.ResponseType.ACCEPT)
        save.add_css_class("suggested-action")
        actions = cancel.get_parent()
        actions.set_halign(Gtk.Align.FILL)
        actions.set_homogeneous(True)
        actions.set_spacing(10)
        actions.set_margin_start(24)
        actions.set_margin_end(24)
        actions.set_margin_bottom(24)
        dialog.set_default_response(Gtk.ResponseType.ACCEPT)
        dialog.set_focus(entry)
        entry.select_region(0, -1)

        def response(item, result):
            if result == Gtk.ResponseType.ACCEPT and tab.page in self.tabs:
                tab.rename(entry.get_text())
            item.destroy()
            active = self.active_tab()
            if active:
                active.terminal.grab_focus()

        dialog.connect("response", response)
        PopupReveal(dialog).present()

    def request_close_tab(self, tab: TerminalTab) -> None:
        if tab.running:
            self._confirm("关闭此标签页？", "此标签页中的运行任务将结束。", lambda: self._remove_tab(tab), "关闭标签页")
        else:
            self._remove_tab(tab)

    def close_current_tab(self) -> None:
        tab = self.active_tab()
        if tab:
            self.request_close_tab(tab)

    def _remove_tab(self, tab: TerminalTab) -> None:
        page_number = self.notebook.page_num(tab.page)
        if page_number < 0:
            return
        self.notebook.remove_page(page_number)
        self.tabs.pop(tab.page, None)
        if not self.tabs:
            self._allow_close = True
            self.close()
        else:
            self.update_title()

    def _close_requested(self, _window: Gtk.Window) -> bool:
        if self._allow_close or not any(tab.running for tab in self.tabs.values()):
            return False
        self._confirm("关闭终端？", "所有标签页中的运行任务将结束。\n请确认已保留需要的终端输出。", self._close_after_confirmation)
        return True

    def _close_after_confirmation(self) -> None:
        self._allow_close = True
        self.close()

    def _confirm(self, title: str, detail: str, on_confirm, action_label: str = "关闭终端") -> None:
        dialog = Gtk.Dialog(title=title, transient_for=self, modal=True)
        dialog.add_css_class("terminal-confirmation")
        dialog.add_css_class(f"profile-{self.settings.profile.lower()}")
        dialog.set_default_size(380, -1)
        dialog.set_resizable(False)
        # Use GTK's dialog semantics with a compact custom title area.
        dialog.set_titlebar(Gtk.Box())
        content = dialog.get_content_area()
        body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        body.set_margin_start(28)
        body.set_margin_end(28)
        body.set_margin_top(28)
        body.set_margin_bottom(24)
        icon = Gtk.Image.new_from_icon_name("utilities-terminal-symbolic")
        icon.set_pixel_size(28)
        icon.set_halign(Gtk.Align.CENTER)
        icon.add_css_class("confirmation-icon")
        icon.update_state([Gtk.AccessibleState.HIDDEN], [True])
        heading = Gtk.Label(label=title)
        heading.add_css_class("confirmation-title")
        description = Gtk.Label(label=detail, wrap=True, justify=Gtk.Justification.CENTER)
        description.set_max_width_chars(34)
        description.add_css_class("confirmation-description")
        for widget in (icon, heading, description):
            body.append(widget)
        content.append(body)
        cancel = dialog.add_button("取消", Gtk.ResponseType.CANCEL)
        confirm = dialog.add_button(action_label, Gtk.ResponseType.ACCEPT)
        cancel.add_css_class("confirmation-cancel")
        confirm.add_css_class("confirmation-close")
        actions = cancel.get_parent()
        actions.set_halign(Gtk.Align.FILL)
        actions.set_homogeneous(True)
        actions.set_spacing(10)
        actions.set_margin_start(28)
        actions.set_margin_end(28)
        actions.set_margin_bottom(24)
        dialog.set_default_response(Gtk.ResponseType.CANCEL)
        dialog.set_focus(cancel)
        dialog.connect("response", lambda item, response: (item.destroy(), on_confirm() if response == Gtk.ResponseType.ACCEPT else None))
        PopupReveal(dialog).present()

    def update_title(self) -> None:
        tab = self.active_tab()
        self._sync_title(tab)
        if tab:
            self.queue_title_update()

    def _sync_title(self, tab: TerminalTab | None) -> None:
        title = f"{tab.label.get_text()} — {APP_NAME}" if tab else APP_NAME
        if self.get_title() != title:
            self.set_title(title)
        if tab:
            directory = tab.display_directory
            subtitle = f"{self._shell_name} · {self.settings.profile}"
            self.header_title.set_tooltip_text(str(directory))
            self.header_subtitle.set_tooltip_text(subtitle)

    def _prepare_switch_page(self, _notebook, page: Gtk.Widget, _index: int) -> None:
        outgoing = self.active_tab()
        self._pending_transition = self.tab_transition.capture(
            outgoing.page if outgoing and outgoing.page is not page else None
        )

    def _on_switch_page(self, _notebook, page: Gtk.Widget, _index: int) -> None:
        image, self._pending_transition = self._pending_transition, None
        tab = self.tabs.get(page)
        if tab:
            # Run after GTK maps the new page, so input goes to its VTE widget.
            tab.terminal.grab_focus()
            self._sync_title(tab)
            self.queue_title_update()
            self.tab_transition.start(tab.page, image)

    def queue_title_update(self) -> None:
        if not self._title_update_source:
            self._title_update_source = GLib.idle_add(self._flush_title_update)

    def _flush_title_update(self) -> bool:
        self._title_update_source = 0
        tab = self.active_tab()
        if tab:
            tab.display_directory = tab.current_directory()
            self._sync_title(tab)
        return GLib.SOURCE_REMOVE

    def _cancel_title_update(self, _window) -> None:
        Gtk.StyleContext.remove_provider_for_display(self.get_display(), self._background_css)
        self.tab_transition.stop()
        self._pending_transition = None
        if self._motion_warm_source:
            GLib.source_remove(self._motion_warm_source)
            self._motion_warm_source = 0
        if self._title_update_source:
            GLib.source_remove(self._title_update_source)
            self._title_update_source = 0

    def _schedule_motion_warmup(self, _window) -> None:
        if not self._motion_warm_source:
            self._motion_warm_attempts = 0
            self._motion_warm_source = GLib.timeout_add(50, self._warm_motion)

    def _warm_motion(self) -> bool:
        self._motion_warm_attempts += 1
        tab = self.active_tab()
        if self.get_mapped() and tab:
            if not self.tab_transition.warm(tab.page) and self._motion_warm_attempts < 3:
                return GLib.SOURCE_CONTINUE
        self._motion_warm_source = 0
        return GLib.SOURCE_REMOVE

    def apply_chrome(self) -> None:
        if self._wallpaper_path != self.settings.wallpaper:
            self._wallpaper_path = self.settings.wallpaper
            self._wallpaper_texture = load_wallpaper(self._wallpaper_path)
        for name in PROFILES:
            self.remove_css_class(f"profile-{name.lower()}")
        self.add_css_class(f"profile-{self.settings.profile.lower()}")
        background = terminal_palette(self.settings)["background"]
        self._background_css.load_from_string(f".{self._background_class} .terminal-page {{ background-color: {background}; }}")
        self.update_title()

    def move_tab(self, offset: int) -> None:
        count = self.notebook.get_n_pages()
        if count > 1:
            self.notebook.set_current_page((self.notebook.get_current_page() + offset) % count)

    def copy(self) -> None:
        tab = self.active_tab()
        if tab:
            tab.terminal.copy_clipboard()

    def paste(self) -> None:
        tab = self.active_tab()
        if tab:
            tab.terminal.paste_clipboard()

    def select_all(self) -> None:
        tab = self.active_tab()
        if tab:
            tab.terminal.select_all()

    def zoom(self, amount: int) -> None:
        self.zoom_font_size = adjusted_font_size(self.zoom_font_size, self.settings.font_size, amount)
        for tab in self.tabs.values():
            self.apply_settings(tab.terminal)

    def apply_settings(self, terminal: Vte.Terminal) -> None:
        terminal.add_css_class("transparent-terminal")
        terminal.get_style_context().add_provider(self._terminal_css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1)
        palette = terminal_palette(self.settings)
        background = rgba(palette["background"])
        if self._wallpaper_texture is not None:
            background.alpha = 0
        terminal.set_color_background(background)
        terminal.set_color_foreground(rgba(palette["foreground"]))
        terminal.set_color_cursor(rgba(palette["cursor"]))
        terminal.set_font(Pango.FontDescription.from_string(f"{self.settings.font_family} {self.zoom_font_size}"))
        terminal.set_cursor_blink_mode(Vte.CursorBlinkMode.ON)

    def _save_and_apply(self) -> bool:
        try:
            save_settings(self.settings)
        except OSError as error:
            self.show_error(f"Could not save preferences: {error}")
            return False
        self.apply_chrome()
        for tab in self.tabs.values():
            self.apply_settings(tab.terminal)
            tab.prompt_refresh.set_color(self.settings.username_color)
            tab.background_surface.update(self._wallpaper_texture, self.settings.wallpaper_opacity, terminal_palette(self.settings)["background"])
        return True

    def preferences(self) -> None:
        dialog = Gtk.Window(title="外观设置", transient_for=self, modal=True)
        dialog.add_css_class("terminal-preferences")
        dialog.add_css_class(f"profile-{self.settings.profile.lower()}")
        dialog.set_default_size(480, 700)
        header = Gtk.HeaderBar()
        header.set_title_widget(Gtk.Label(label="外观设置"))
        dialog.set_titlebar(header)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        box.set_margin_start(24)
        box.set_margin_end(24)
        box.set_margin_top(24)
        box.set_margin_bottom(24)
        layout = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        scroller = Gtk.ScrolledWindow(vexpand=True)
        scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroller.set_propagate_natural_width(True)
        scroller.set_child(box)
        layout.append(scroller)
        dialog.set_child(layout)
        box.append(Gtk.Label(label="让终端适合你", xalign=0, css_classes=["section-title"]))
        box.append(Gtk.Label(label="选择配色与字体，应用到所有标签页。", xalign=0, css_classes=["settings-description"]))
        group = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0, css_classes=["settings-group"])
        box.append(group)

        profile_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        profile_row.add_css_class("settings-row")
        profile_row.append(Gtk.Label(label="配色方案", xalign=0, hexpand=True))
        names = list(PROFILES)
        profile = Gtk.DropDown.new_from_strings(names)
        profile.set_selected(names.index(self.settings.profile))
        profile_row.append(profile)
        group.append(profile_row)

        background_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16, css_classes=["settings-row"])
        background_row.append(Gtk.Label(label="背景颜色", xalign=0, hexpand=True))
        preset_names = list(BACKGROUND_PRESETS)
        background_options = ["跟随配色方案", *preset_names, "自定义"]
        background_choice = Gtk.DropDown.new_from_strings(background_options)
        background_choice.update_property([Gtk.AccessibleProperty.LABEL], ["背景颜色"])
        stored_background = normalize_background(self.settings.background)
        preset_values = list(BACKGROUND_PRESETS.values())
        if stored_background is None:
            initial_choice = 0
        elif stored_background in preset_values:
            initial_choice = preset_values.index(stored_background) + 1
        else:
            initial_choice = len(background_options) - 1
        background_choice.set_selected(initial_choice)
        background_row.append(background_choice)
        group.append(background_row)

        color_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10, css_classes=["settings-row"])
        color_row.append(Gtk.Label(label="颜色值", xalign=0, hexpand=True))
        color_entry = Gtk.Entry()
        color_entry.set_width_chars(9)
        color_entry.set_max_width_chars(9)
        color_entry.set_placeholder_text("#RRGGBB")
        color_entry.add_css_class("background-color-input")
        color_entry.update_property([Gtk.AccessibleProperty.LABEL], ["自定义背景颜色，十六进制色值"])
        chooser = Gtk.ColorDialog()
        chooser.set_title("自定义背景颜色")
        chooser.set_with_alpha(False)
        color_button = Gtk.ColorDialogButton.new(chooser)
        color_button.set_tooltip_text("选择背景颜色")
        color_button.update_property([Gtk.AccessibleProperty.LABEL], ["选择背景颜色"])
        color_row.append(color_entry)
        color_row.append(color_button)
        group.append(color_row)

        username_names = list(USERNAME_COLOR_PRESETS)
        username_values = list(USERNAME_COLOR_PRESETS.values())
        username_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16, css_classes=["settings-row"])
        username_row.append(Gtk.Label(label="用户名与主机名颜色", xalign=0, hexpand=True))
        username_choice = Gtk.DropDown.new_from_strings([*username_names, "自定义"])
        username_choice.add_css_class("username-color-choice")
        username_choice.update_property([Gtk.AccessibleProperty.LABEL], ["用户名与主机名颜色预设"])
        username_choice.set_selected(username_values.index(self.settings.username_color) if self.settings.username_color in username_values else len(username_names))
        username_row.append(username_choice)
        group.append(username_row)
        username_custom_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10, css_classes=["settings-row"])
        username_custom_row.append(Gtk.Label(label="提示符色值", xalign=0, hexpand=True))
        username_entry = Gtk.Entry(text=self.settings.username_color)
        username_entry.set_width_chars(9)
        username_entry.set_max_width_chars(9)
        username_entry.add_css_class("username-color-input")
        username_entry.update_property([Gtk.AccessibleProperty.LABEL], ["用户名与主机名颜色，十六进制色值"])
        username_picker_dialog = Gtk.ColorDialog(title="自定义用户名与主机名颜色", with_alpha=False)
        username_picker = Gtk.ColorDialogButton.new(username_picker_dialog)
        username_picker.add_css_class("username-color-picker")
        username_picker.set_rgba(rgba(self.settings.username_color))
        username_picker.update_property([Gtk.AccessibleProperty.LABEL], ["选择用户名与主机名颜色"])
        username_picker.set_tooltip_text("选择用户名与主机名颜色")
        username_custom_row.append(username_entry)
        username_custom_row.append(username_picker)
        group.append(username_custom_row)
        username_error = Gtk.Label(label="提示符颜色需为有效色值，例如 #28c840 或 #abc。", wrap=True, xalign=0, css_classes=["color-error"])
        username_error.set_visible(False)
        group.append(username_error)

        pending_wallpaper = self.settings.wallpaper
        pending_texture = self._wallpaper_texture
        wallpaper_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, css_classes=["settings-row"])
        wallpaper_row.append(Gtk.Label(label="壁纸", xalign=0))
        wallpaper_name = Gtk.Label(xalign=0, hexpand=True)
        wallpaper_name.set_ellipsize(Pango.EllipsizeMode.END)
        wallpaper_name.set_max_width_chars(16)
        import_button = Gtk.Button(label="导入图片")
        remove_button = Gtk.Button(label="移除")
        import_button.add_css_class("wallpaper-action")
        remove_button.add_css_class("wallpaper-action")
        for widget in (wallpaper_name, import_button, remove_button):
            wallpaper_row.append(widget)
        group.append(wallpaper_row)
        opacity_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12, css_classes=["settings-row"])
        opacity_row.append(Gtk.Label(label="壁纸透明度", xalign=0))
        opacity = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1)
        opacity.set_hexpand(True)
        opacity.set_draw_value(False)
        opacity.set_value((1 - self.settings.wallpaper_opacity) * 100)
        opacity.update_property([Gtk.AccessibleProperty.LABEL], ["壁纸透明度"])
        opacity_value = Gtk.Label(label="35%", width_chars=4)
        opacity_row.append(opacity)
        opacity_row.append(opacity_value)
        group.append(opacity_row)

        font_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        font_row.add_css_class("settings-row")
        font_row.append(Gtk.Label(label="等宽字体", xalign=0, hexpand=True))
        installed_fonts = {item.get_name() for item in self.get_pango_context().list_families() if item.is_monospace()}
        preferred_fonts = (
            "DejaVu Sans Mono", "Liberation Mono", "Noto Mono", "FreeMono",
            "JetBrains Mono", "Fira Code", "Cascadia Code", "Source Code Pro",
            "Hack", "Ubuntu Mono", "Nimbus Mono PS", "Courier New", "Andale Mono",
        )
        font_names = ["Monospace", *(name for name in preferred_fonts if name in installed_fonts)]
        if self.settings.font_family in installed_fonts and self.settings.font_family not in font_names:
            font_names.append(self.settings.font_family)
        font_choice = Gtk.DropDown.new_from_strings([*font_names, "自定义字体"])
        font_choice.add_css_class("font-family-choice")
        font_choice.set_enable_search(True)
        font_choice.update_property([Gtk.AccessibleProperty.LABEL], ["等宽字体"])
        font_choice.set_selected(font_names.index(self.settings.font_family) if self.settings.font_family in font_names else len(font_names))
        font_row.append(font_choice)
        group.append(font_row)

        custom_font_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16, css_classes=["settings-row"])
        custom_font_row.append(Gtk.Label(label="字体名称", xalign=0, hexpand=True))
        family = Gtk.Entry(text=self.settings.font_family)
        family.set_width_chars(18)
        family.add_css_class("font-family-input")
        family.update_property([Gtk.AccessibleProperty.LABEL], ["自定义字体名称"])
        family.set_tooltip_text("填写已安装的字体名称；找不到时会使用系统备用字体。")
        custom_font_row.append(family)
        custom_font_row.set_visible(font_choice.get_selected() == len(font_names))
        group.append(custom_font_row)

        size_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        size_row.add_css_class("settings-row")
        size_row.append(Gtk.Label(label="字号", xalign=0, hexpand=True))
        size = Gtk.SpinButton.new_with_range(8, 32, 1)
        size.update_property([Gtk.AccessibleProperty.LABEL], ["终端字号"])
        size.set_value(self.settings.font_size)
        size_row.append(size)
        group.append(size_row)
        box.append(Gtk.Label(label="用户名与主机名共用颜色，用于 Bash 提示符。空闲时立即更新；运行命令时返回提示符后生效。", wrap=True, xalign=0, css_classes=["settings-description"]))

        save = Gtk.Button(label="应用设置")
        save.add_css_class("suggested-action")
        save.set_halign(Gtk.Align.END)
        color_error = Gtk.Label(label="请输入有效色值，例如 #1a2433 或 #abc。", wrap=True, xalign=0)
        color_error.add_css_class("color-error")
        color_error.set_visible(False)
        wallpaper_error = Gtk.Label(wrap=True, xalign=0, css_classes=["color-error"])
        wallpaper_error.set_visible(False)
        box.append(wallpaper_error)
        box.append(color_error)
        preview = Vte.Terminal()
        preview.add_css_class("transparent-terminal")
        preview.get_style_context().add_provider(self._terminal_css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1)
        preview.set_size_request(-1, 64)
        preview.set_can_target(False)
        preview.set_focusable(False)
        preview.set_font(Pango.FontDescription.from_string("Monospace 11"))
        preview.feed(b"\x1b[?25lsong@debian:~$ echo hello\r\nhello\r\n")
        preview.update_property([Gtk.AccessibleProperty.LABEL], ["字体与背景预览"])
        preview_label = Gtk.Label(label="外观预览", xalign=0, css_classes=["settings-description"])
        preview_surface = WallpaperSurface(preview)
        preview_surface.set_vexpand(False)
        preview_clip = Gtk.ScrolledWindow()
        preview_clip.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.EXTERNAL)
        preview_clip.set_size_request(-1, 64)
        preview_clip.set_min_content_height(64)
        preview_clip.set_max_content_height(64)
        preview_clip.set_propagate_natural_height(True)
        preview_clip.set_vexpand(False)
        preview_clip.set_child(preview_surface)
        preview_frame = Gtk.Frame(child=preview_clip, css_classes=["background-preview"])
        preview_frame.set_vexpand(False)
        preview_frame.set_overflow(Gtk.Overflow.HIDDEN)
        syncing_color = False
        syncing_username = False

        def update_preview():
            font = Pango.FontDescription()
            font.set_family(family.get_text().strip()[:100] or "Monospace")
            font.set_size(size.get_value_as_int() * Pango.SCALE)
            preview.set_font(font)
            custom = normalize_background(color_entry.get_text())
            valid = custom is not None
            color_error.set_visible(not valid)
            color_entry.update_state([Gtk.AccessibleState.INVALID], [int(Gtk.AccessibleInvalidState.FALSE if valid else Gtk.AccessibleInvalidState.TRUE)])
            color_entry.update_property([Gtk.AccessibleProperty.DESCRIPTION], ["#RRGGBB 或 #RGB" if valid else color_error.get_text()])
            username_color = normalize_background(username_entry.get_text())
            username_valid = username_color is not None
            username_error.set_visible(not username_valid)
            username_entry.update_state([Gtk.AccessibleState.INVALID], [int(Gtk.AccessibleInvalidState.FALSE if username_valid else Gtk.AccessibleInvalidState.TRUE)])
            username_entry.update_property([Gtk.AccessibleProperty.DESCRIPTION], ["#RRGGBB 或 #RGB" if username_valid else username_error.get_text()])
            save.set_sensitive(valid and username_valid and (not pending_wallpaper or pending_texture is not None))
            if username_color:
                red, green, blue = (int(username_color[index:index + 2], 16) for index in (1, 3, 5))
                preview.feed(f"\x1b[2J\x1b[H\x1b[?25l\x1b[38;2;{red};{green};{blue}msong@debian\x1b[0m:~$ echo hello\r\nhello\r\n".encode())
            wallpaper_name.set_text(Path(pending_wallpaper).name if pending_wallpaper else "未选择")
            wallpaper_name.set_tooltip_text(pending_wallpaper)
            remove_button.set_sensitive(bool(pending_wallpaper))
            opacity.set_sensitive(pending_texture is not None)
            opacity_value.set_text(f"{round(opacity.get_value())}%")
            if valid:
                selected = background_choice.get_selected()
                colors = terminal_palette(Settings(profile=names[profile.get_selected()], background=custom if selected else None))
                background = rgba(colors["background"])
                if pending_texture is not None:
                    background.alpha = 0
                preview.set_color_background(background)
                preview.set_color_foreground(rgba(colors["foreground"]))
                preview_surface.update(pending_texture, 1 - opacity.get_value() / 100, colors["background"])

        def choose_username_color(*_args):
            if syncing_username:
                return
            selected = username_choice.get_selected()
            if selected < len(username_names):
                if normalize_background(username_entry.get_text()) != username_values[selected]:
                    username_entry.set_text(username_values[selected])
            update_preview()

        def typed_username_color(*_args):
            nonlocal syncing_username
            if syncing_username:
                return
            syncing_username = True
            color = normalize_background(username_entry.get_text())
            selected = username_values.index(color) if color in username_values else len(username_names)
            if username_choice.get_selected() != selected:
                username_choice.set_selected(selected)
            if color:
                selected_color = rgba(color)
                if not username_picker.get_rgba().equal(selected_color):
                    username_picker.set_rgba(selected_color)
            syncing_username = False
            update_preview()

        def picked_username_color(*_args):
            if syncing_username:
                return
            color = username_picker.get_rgba()
            text = "#" + "".join(f"{round(channel * 255):02x}" for channel in (color.red, color.green, color.blue))
            if normalize_background(username_entry.get_text()) != text:
                username_entry.set_text(text)

        username_choice.connect("notify::selected", choose_username_color)
        username_entry.connect("changed", typed_username_color)
        username_picker.connect("notify::rgba", picked_username_color)

        def choose_font(*_args):
            selected = font_choice.get_selected()
            custom_font_row.set_visible(selected == len(font_names))
            if selected < len(font_names):
                family.set_text(font_names[selected])
            update_preview()

        font_choice.connect("notify::selected", choose_font)
        family.connect("changed", lambda *_args: update_preview())
        size.connect("value-changed", lambda *_args: update_preview())

        def remove_wallpaper(*_args):
            nonlocal pending_wallpaper, pending_texture
            pending_wallpaper = pending_texture = None
            wallpaper_error.set_visible(False)
            update_preview()

        def choose_wallpaper(*_args):
            picker = Gtk.FileDialog()
            picker.set_title("导入终端壁纸")
            images = Gtk.FileFilter()
            images.set_name("图片文件")
            images.add_mime_type("image/*")
            filters = Gio.ListStore.new(Gtk.FileFilter)
            filters.append(images)
            picker.set_filters(filters)

            def selected(source, result):
                nonlocal pending_wallpaper, pending_texture
                try:
                    file = source.open_finish(result)
                except GLib.Error:
                    return
                if not dialog.get_visible():
                    return
                path = file.get_path()
                texture = load_wallpaper(path)
                if texture is None:
                    wallpaper_error.set_text("无法读取这张图片，请选择支持的本地图片文件。")
                    wallpaper_error.set_visible(True)
                    return
                pending_wallpaper, pending_texture = path, texture
                wallpaper_error.set_visible(False)
                update_preview()

            picker.open(dialog, None, selected)

        import_button.connect("clicked", choose_wallpaper)
        remove_button.connect("clicked", remove_wallpaper)
        opacity.connect("value-changed", lambda *_args: update_preview())

        def sync_color(*_args):
            nonlocal syncing_color
            if syncing_color:
                return
            selected = background_choice.get_selected()
            if selected == 0:
                color = PROFILES[names[profile.get_selected()]]["background"]
            elif selected <= len(preset_names):
                color = BACKGROUND_PRESETS[preset_names[selected - 1]]
            else:
                color = normalize_background(color_entry.get_text()) or stored_background or terminal_palette(self.settings)["background"]
            syncing_color = True
            color_entry.set_text(color)
            color_button.set_rgba(rgba(color))
            syncing_color = False
            update_preview()

        def typed_color(*_args):
            nonlocal syncing_color
            if syncing_color:
                return
            syncing_color = True
            background_choice.set_selected(len(background_options) - 1)
            color = normalize_background(color_entry.get_text())
            if color:
                color_button.set_rgba(rgba(color))
            syncing_color = False
            update_preview()

        def picked_color(*_args):
            if syncing_color:
                return
            color = color_button.get_rgba()
            color_entry.set_text("#" + "".join(f"{round(channel * 255):02x}" for channel in (color.red, color.green, color.blue)))

        background_choice.connect("notify::selected", sync_color)
        profile.connect("notify::selected", sync_color)
        color_entry.connect("changed", typed_color)
        color_button.connect("notify::rgba", picked_color)
        sync_color()
        if pending_wallpaper and pending_texture is None:
            wallpaper_error.set_text("原壁纸无法读取，请重新导入或移除。")
            wallpaper_error.set_visible(True)

        def apply(_button):
            chosen_family = family.get_text().strip()[:100] or "Monospace"
            color = normalize_background(color_entry.get_text())
            username_color = normalize_background(username_entry.get_text())
            if color is None or username_color is None:
                return
            try:
                wallpaper = import_wallpaper(pending_wallpaper) if pending_wallpaper else None
            except (OSError, ValueError) as error:
                wallpaper_error.set_text(f"导入壁纸失败：{error}")
                wallpaper_error.set_visible(True)
                return
            previous_settings, previous_zoom = self.settings, self.zoom_font_size
            self.settings = Settings(names[profile.get_selected()], chosen_family, size.get_value_as_int(), color if background_choice.get_selected() else None, wallpaper, 1 - opacity.get_value() / 100, username_color)
            self.zoom_font_size = self.settings.font_size
            if not self._save_and_apply():
                self.settings, self.zoom_font_size = previous_settings, previous_zoom
                if wallpaper != previous_settings.wallpaper and wallpaper != pending_wallpaper:
                    remove_wallpaper_copy(wallpaper)
                return
            if previous_settings.wallpaper != wallpaper:
                remove_wallpaper_copy(previous_settings.wallpaper)
            dialog.close()

        save.connect("clicked", apply)
        footer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        footer.set_vexpand(False)
        footer.set_margin_start(24)
        footer.set_margin_end(24)
        footer.set_margin_top(12)
        footer.set_margin_bottom(24)
        save.set_hexpand(True)
        footer.append(preview_label)
        footer.append(preview_frame)
        footer.append(save)
        layout.append(footer)
        dialog.present()

    def find(self) -> None:
        tab = self.active_tab()
        if not tab:
            return
        dialog = Gtk.Window(title="查找", transient_for=self, modal=True)
        dialog.add_css_class("terminal-preferences")
        dialog.add_css_class(f"profile-{self.settings.profile.lower()}")
        dialog.set_default_size(420, 120)
        header = Gtk.HeaderBar()
        header.set_title_widget(Gtk.Label(label="查找终端内容"))
        dialog.set_titlebar(header)
        box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        box.set_margin_start(16)
        box.set_margin_end(16)
        box.set_margin_top(16)
        box.set_margin_bottom(16)
        entry = Gtk.SearchEntry(hexpand=True)
        entry.set_placeholder_text("输入要查找的文本")
        box.append(entry)
        button = Gtk.Button(label="下一个")
        box.append(button)
        dialog.set_child(box)

        def search(*_args):
            query = entry.get_text()
            if query:
                try:
                    expression = Vte.Regex.new_for_search(re.escape(query), -1, 0)
                    tab.terminal.search_set_regex(expression, 0)
                    tab.terminal.search_set_wrap_around(True)
                    tab.terminal.search_find_next()
                except GLib.Error as error:
                    self.show_error(f"Search failed: {error}")

        button.connect("clicked", search)
        entry.connect("activate", search)
        dialog.present()

    def about(self) -> None:
        dialog = Gtk.AboutDialog(transient_for=self, modal=True)
        dialog.set_program_name(APP_NAME)
        dialog.set_logo_icon_name(ICON_NAME)
        dialog.set_version("0.1.0")
        dialog.set_comments("A compact Debian terminal inspired by the clarity of Mac Terminal.")
        dialog.present()

    def show_error(self, message: str) -> None:
        dialog = Gtk.AlertDialog()
        dialog.set_message(message)
        dialog.set_buttons(["OK"])
        dialog.show(self)


class TerminalApplication(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="io.github.macstyle.Terminal", flags=Gio.ApplicationFlags.DEFAULT_FLAGS)
        if GLib.get_application_name() != APP_NAME:
            GLib.set_application_name(APP_NAME)

    def do_activate(self) -> None:
        window = self.get_active_window()
        if window is None:
            provider = Gtk.CssProvider()
            provider.load_from_path(str(Path(__file__).with_name("style.css")))
            Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
            window = TerminalWindow(self)
        window.present()
