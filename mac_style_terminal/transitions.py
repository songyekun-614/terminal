"""Short, interruptible fades driven by GTK's frame clock."""

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import GLib, Gtk


class PopupReveal:
    """Fade a popup in without delaying focus or its response handlers."""

    def __init__(self, window: Gtk.Window, duration_ms: int = 160):
        self.window = window
        self.duration_ms = duration_ms
        self._tick_id = 0
        self._unmap_id = 0
        self._started_at = None

    @property
    def running(self) -> bool:
        return bool(self._tick_id)

    def _enabled(self) -> bool:
        return self.duration_ms > 0 and self.window.get_settings().get_property("gtk-enable-animations")

    def present(self) -> None:
        self.stop()
        if self._enabled():
            # Prepare before mapping so the first visible frame cannot flash.
            self.window.set_opacity(0)
            self._unmap_id = self.window.connect("unmap", lambda _window: self.stop())
            self._tick_id = self.window.add_tick_callback(self._tick)
        self.window.present()

    def _tick(self, window, clock, *_data) -> bool:
        if not window.get_mapped() or not self._enabled():
            self._clear(remove_tick=False)
            return GLib.SOURCE_REMOVE
        if self._started_at is None:
            # Start on the first frame, after native window creation finishes.
            self._started_at = clock.get_frame_time()
        progress = min(1.0, max(0.0, (clock.get_frame_time() - self._started_at) / (self.duration_ms * 1000)))
        window.set_opacity(1 - (1 - progress) ** 3)
        if progress >= 1:
            self._clear(remove_tick=False)
            return GLib.SOURCE_REMOVE
        return GLib.SOURCE_CONTINUE

    def stop(self) -> None:
        self._clear(remove_tick=True)

    def _clear(self, remove_tick: bool) -> None:
        tick_id, self._tick_id = self._tick_id, 0
        unmap_id, self._unmap_id = self._unmap_id, 0
        self._started_at = None
        if remove_tick and tick_id:
            self.window.remove_tick_callback(tick_id)
        if unmap_id:
            self.window.disconnect(unmap_id)
        self.window.set_opacity(1)


class TabTransition:
    def __init__(self, duration_ms: int = 180):
        self.duration_ms = duration_ms
        self._host = None
        self._picture = None
        self._tick_id = 0
        self._started_at = 0
        self._warmed_renderer = None

    @property
    def running(self) -> bool:
        return self._picture is not None

    def capture(self, outgoing: Gtk.Overlay | None):
        if outgoing is None or not outgoing.get_mapped() or not self._enabled(outgoing):
            self.stop()
            return None
        if self.running and self._host is outgoing:
            if self._picture.get_opacity() >= 0.999:
                # Before the first animation frame, the previous image is still visible.
                image = self._picture.get_paintable()
            else:
                image = self._freeze_visible_frame(outgoing)
        else:
            content = outgoing.get_child()
            image = Gtk.WidgetPaintable.new(content).get_current_image() if content else None
        # Preserve the visible composite before removing its overlay.
        self.stop()
        if image is None:
            return None
        if image.get_intrinsic_width() <= 0 or image.get_intrinsic_height() <= 0:
            return None
        return image

    def _freeze_visible_frame(self, page: Gtk.Overlay):
        image = Gtk.WidgetPaintable.new(page).get_current_image()
        native = page.get_native()
        renderer = native.get_renderer() if native else None
        if renderer is None:
            return image
        snapshot = Gtk.Snapshot()
        image.snapshot(snapshot, image.get_intrinsic_width(), image.get_intrinsic_height())
        node = snapshot.to_node()
        # Flatten interruptions to one texture instead of retaining nested old fades.
        return renderer.render_texture(node, None) if node else image

    def warm(self, page: Gtk.Overlay) -> bool:
        """Prime offscreen rendering before the user interrupts a fade."""
        if not self._enabled(page):
            return True
        native = page.get_native()
        renderer = native.get_renderer() if native else None
        if renderer is None or not page.get_mapped() or page.get_width() <= 0:
            return False
        if self._warmed_renderer is renderer:
            return True
        image = Gtk.WidgetPaintable.new(page).get_current_image()
        if image.get_intrinsic_width() <= 0 or image.get_intrinsic_height() <= 0:
            return False
        snapshot = Gtk.Snapshot()
        image.snapshot(snapshot, image.get_intrinsic_width(), image.get_intrinsic_height())
        node = snapshot.to_node()
        if node is None:
            return False
        renderer.render_texture(node, None)
        self._warmed_renderer = renderer
        return True

    def start(self, incoming: Gtk.Overlay, image) -> None:
        self.stop()
        if image is None or not incoming.get_mapped() or not self._enabled(incoming):
            return
        picture = Gtk.Picture.new_for_paintable(image)
        picture.set_content_fit(Gtk.ContentFit.FILL)
        picture.set_can_target(False)
        picture.set_focusable(False)
        picture.update_state([Gtk.AccessibleState.HIDDEN], [True])
        picture.set_hexpand(True)
        picture.set_vexpand(True)
        incoming.add_overlay(picture)
        incoming.set_measure_overlay(picture, False)
        incoming.set_clip_overlay(picture, True)
        self._host = incoming
        self._picture = picture
        self._started_at = GLib.get_monotonic_time()
        self._tick_id = incoming.add_tick_callback(self._tick)

    def _enabled(self, widget) -> bool:
        return self.duration_ms > 0 and widget.get_settings().get_property("gtk-enable-animations")

    def _tick(self, host, clock, *_data) -> bool:
        if not host.get_mapped() or not self._enabled(host):
            self._clear(remove_tick=False)
            return GLib.SOURCE_REMOVE
        progress = min(1.0, max(0.0, (clock.get_frame_time() - self._started_at) / (self.duration_ms * 1000)))
        if progress >= 1:
            self._clear(remove_tick=False)
            return GLib.SOURCE_REMOVE
        # Cubic ease-out: only the cached outgoing image changes opacity.
        self._picture.set_opacity((1.0 - progress) ** 3)
        return GLib.SOURCE_CONTINUE

    def stop_for(self, page: Gtk.Overlay) -> None:
        if self._host is page:
            self.stop()

    def stop(self) -> None:
        self._clear(remove_tick=True)

    def _clear(self, remove_tick: bool) -> None:
        host, picture, tick_id = self._host, self._picture, self._tick_id
        self._host = self._picture = None
        self._tick_id = 0
        if host is not None:
            if remove_tick and tick_id:
                host.remove_tick_callback(tick_id)
            if picture is not None and picture.get_parent() is host:
                host.remove_overlay(picture)
