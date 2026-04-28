"""Smoke harness for the Python SDK against a running subtick api.

Exits non-zero if any step fails. Used by the Phase 1 Step 2 validation.
"""

from __future__ import annotations

import sys
import threading
import time

# Make the local package importable without installing.
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from subtick_sdk import (
    AccountNotFound,
    SubtickClient,
    TransportError,
    TxRejected,
    subscribe_events,
)


KNOWN_ADDR = "edd571b0cb522c030d9602321b5bf201a6d3feae235470e51d26da0f5f328d5d"
ZERO_ADDR = "0000000000000000000000000000000000000000000000000000000000000000"


def main() -> int:
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
    pass_count = 0
    fail_count = 0

    def ok(name: str) -> None:
        nonlocal pass_count
        pass_count += 1
        print(f"PASS {name}")

    def bad(name: str, err: object) -> None:
        nonlocal fail_count
        fail_count += 1
        print(f"FAIL {name}: {err}")

    client = SubtickClient(base_url=base_url)

    # 1. health
    try:
        h = client.health()
        if h.status == "ok" and h.account_count > 0:
            ok("health")
        else:
            bad("health", f"unexpected: {h}")
    except Exception as e:
        bad("health", e)

    # 2. balance for funded account
    try:
        b = client.get_balance(KNOWN_ADDR)
        if isinstance(b, int) and b > 0:
            ok(f"get_balance funded ({b})")
        else:
            bad("get_balance funded", f"unexpected: {b!r}")
    except Exception as e:
        bad("get_balance funded", e)

    # 3. account for funded
    try:
        a = client.get_account(KNOWN_ADDR)
        if a.address == KNOWN_ADDR and a.balance > 0 and a.nonce == 0:
            ok("get_account funded")
        else:
            bad("get_account funded", f"unexpected: {a}")
    except Exception as e:
        bad("get_account funded", e)

    # 4. balance for unknown -> AccountNotFound
    try:
        client.get_balance(ZERO_ADDR)
        bad("get_balance zero-addr", "expected AccountNotFound")
    except AccountNotFound:
        ok("get_balance zero-addr -> AccountNotFound")
    except Exception as e:
        bad("get_balance zero-addr", e)

    # 5. send_tx invalid hex blob -> TxRejected (4xx)
    try:
        client.send_tx("deadbeef")
        bad("send_tx invalid", "expected TxRejected")
    except TxRejected as e:
        ok(f"send_tx invalid -> TxRejected (status={e.status})")
    except Exception as e:
        bad("send_tx invalid", e)

    # 6. send_tx non-hex -> TxRejected
    try:
        client.send_tx("zzzz")
        bad("send_tx non-hex", "expected TxRejected")
    except TxRejected:
        ok("send_tx non-hex -> TxRejected")
    except Exception as e:
        bad("send_tx non-hex", e)

    # 7. WS upgrade — wait for onOpen within 3s
    open_event = threading.Event()
    err_event: list[BaseException] = []
    sub = subscribe_events(
        base_url,
        on_event=lambda _ev: None,
        on_open=lambda: open_event.set(),
        on_error=lambda err: err_event.append(err),
    )
    try:
        if open_event.wait(timeout=3.0):
            ok("subscribe_events -> on_open")
        else:
            bad("subscribe_events", f"no on_open within 3s (errs={err_event})")
    finally:
        sub.stop(timeout=2.0)

    # 8. TransportError on closed port
    try:
        dead = SubtickClient(base_url="http://127.0.0.1:1", timeout_s=1.5)
        dead.health()
        bad("TransportError closed port", "expected TransportError")
    except TransportError:
        ok("TransportError on closed port")
    except Exception as e:
        bad("TransportError closed port", e)

    print(f"\nresult: {pass_count} pass, {fail_count} fail")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
