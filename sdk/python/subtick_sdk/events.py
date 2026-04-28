"""Subtick SDK — synchronous WebSocket event subscriber.

Subscribes to ``WS /v1/events`` and delivers BatchExecuted frames to the
caller's callback. Handles disconnect with simple exponential backoff
(1s → 2s → 4s, capped at 10s).

The subscriber runs on the calling thread; pass ``run()`` your own threading
strategy if you want it in the background. ``stop()`` is safe from any
thread.
"""

from __future__ import annotations

import json
import threading
from typing import Any, Callable

from websocket import WebSocketApp

from .errors import TransportError


_RECONNECT_DELAYS_S = [1.0, 2.0, 4.0, 10.0]


class EventSubscription:
    """Long-lived WS subscription with auto-reconnect.

    The simplest usage is :func:`subscribe_events`, which constructs and
    starts a subscription on a background thread.
    """

    def __init__(
        self,
        url: str,
        on_event: Callable[[dict[str, Any]], None],
        *,
        auto_reconnect: bool = True,
        on_open: Callable[[], None] | None = None,
        on_close: Callable[[int, str], None] | None = None,
        on_error: Callable[[BaseException], None] | None = None,
    ) -> None:
        self.url = url
        self.on_event = on_event
        self.auto_reconnect = auto_reconnect
        self._on_open = on_open or (lambda: None)
        self._on_close = on_close or (lambda code, reason: None)
        self._on_error = on_error or (lambda err: None)

        self._closed = threading.Event()
        self._reconnect_idx = 0
        self._thread: threading.Thread | None = None
        self._app: WebSocketApp | None = None

    def start(self, *, daemon: bool = True) -> EventSubscription:
        """Start the subscription on a background thread. Idempotent."""
        if self._thread is not None and self._thread.is_alive():
            return self
        self._closed.clear()
        self._thread = threading.Thread(target=self._run, daemon=daemon)
        self._thread.start()
        return self

    def stop(self, timeout: float | None = 5.0) -> None:
        """Close the subscription and stop reconnecting."""
        self._closed.set()
        if self._app is not None:
            try:
                self._app.close()
            except Exception:
                pass
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    # ── internals ────────────────────────────────────────────────────────

    def _run(self) -> None:
        while not self._closed.is_set():
            self._connect_once()
            if self._closed.is_set() or not self.auto_reconnect:
                return
            delay = _RECONNECT_DELAYS_S[
                min(self._reconnect_idx, len(_RECONNECT_DELAYS_S) - 1)
            ]
            self._reconnect_idx += 1
            self._closed.wait(timeout=delay)

    def _connect_once(self) -> None:
        def _on_message(_app: WebSocketApp, raw: str | bytes) -> None:
            try:
                parsed = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as err:
                self._on_error(TransportError(f"malformed event frame: {err}", err))
                return
            try:
                self.on_event(parsed)
            except Exception as err:  # noqa: BLE001 — caller's bug, surface it
                self._on_error(err)

        def _on_open(_app: WebSocketApp) -> None:
            self._reconnect_idx = 0
            self._on_open()

        def _on_close(_app: WebSocketApp, code: int | None, reason: str | None) -> None:
            self._on_close(code or 0, reason or "")

        def _on_error(_app: WebSocketApp, err: BaseException) -> None:
            self._on_error(err)

        self._app = WebSocketApp(
            self.url,
            on_message=_on_message,
            on_open=_on_open,
            on_close=_on_close,
            on_error=_on_error,
        )
        try:
            self._app.run_forever(ping_interval=30, ping_timeout=10)
        except Exception as err:  # noqa: BLE001
            self._on_error(err)


def subscribe_events(
    base_url: str,
    on_event: Callable[[dict[str, Any]], None],
    *,
    auto_reconnect: bool = True,
    on_open: Callable[[], None] | None = None,
    on_close: Callable[[int, str], None] | None = None,
    on_error: Callable[[BaseException], None] | None = None,
    daemon: bool = True,
) -> EventSubscription:
    """Subscribe to ``BatchExecuted`` on the given API base URL.

    Returns an already-started :class:`EventSubscription`. Call ``.stop()``
    when done.
    """
    if base_url.startswith("https://"):
        ws_url = "wss://" + base_url[len("https://") :]
    elif base_url.startswith("http://"):
        ws_url = "ws://" + base_url[len("http://") :]
    else:
        ws_url = base_url
    ws_url = ws_url.rstrip("/") + "/v1/events"
    sub = EventSubscription(
        ws_url,
        on_event,
        auto_reconnect=auto_reconnect,
        on_open=on_open,
        on_close=on_close,
        on_error=on_error,
    )
    sub.start(daemon=daemon)
    return sub
