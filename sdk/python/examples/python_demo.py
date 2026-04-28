"""Combined demo: send loop + event listener.

Mirrors the JS examples in one script. Sends a placeholder hex tx every
second (server returns 400 — proves transport) while a background WS
subscription prints BatchExecuted frames as they arrive.

Usage:
    python examples/python_demo.py
    python examples/python_demo.py http://127.0.0.1:18080
"""

from __future__ import annotations

import sys
import time

from subtick_sdk import (
    SubtickClient,
    TransportError,
    TxRejected,
    subscribe_events,
)


# Placeholder hex — clearly invalid. Replace with real signed-tx hex once
# the builder lands (Phase 1 Step 3).
PLACEHOLDER_TX_HEX = (
    "0100000001000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000"
    "00000000000000"
)


def main() -> int:
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080"
    print(f"[python_demo] base={base_url} — Ctrl+C to stop")

    client = SubtickClient(base_url=base_url)

    # Verify the API is reachable before opening the WS.
    try:
        h = client.health()
        print(f"[health] status={h.status} height={h.height} accounts={h.account_count}")
    except TransportError as err:
        print(f"[health] FAILED: {err}")
        return 1

    frames = {"count": 0, "lagged": 0}

    def on_event(event: dict[str, object]) -> None:
        frames["count"] += 1
        if event.get("type") == "Lagged":
            frames["lagged"] += 1
            print(f"[lag] skipped={event.get('skipped')}  total_lag={frames['lagged']}")
            return
        if event.get("type") == "BatchExecuted":
            bid = str(event.get("batch_id", ""))[:12]
            print(
                f"#{frames['count']} BatchExecuted shard={event.get('shard_id')} "
                f"batch={bid}... applied={event.get('group_applied_txs')} "
                f"size={event.get('group_size')}"
            )
            return
        print(f"#{frames['count']} {event.get('type', '?')}: {event}")

    sub = subscribe_events(
        base_url,
        on_event,
        on_open=lambda: print("[ws] connected"),
        on_close=lambda code, reason: print(f"[ws] closed code={code} reason={reason or '(none)'}"),
        on_error=lambda err: print(f"[ws] error: {err}"),
    )

    # Send loop on the main thread.
    sent = accepted = rejected = transport = 0
    try:
        while True:
            sent += 1
            try:
                res = client.send_tx(PLACEHOLDER_TX_HEX)
                accepted += 1
                print(f"#{sent} accepted: {res.tx_hash}")
            except TxRejected as err:
                rejected += 1
                print(f"#{sent} rejected: {err} (retryable={err.retryable})")
            except TransportError as err:
                transport += 1
                print(f"#{sent} transport: {err}")
            except Exception as err:  # noqa: BLE001
                print(f"#{sent} unknown: {err}")
            if sent % 10 == 0:
                print(
                    f"  -- sent={sent} accepted={accepted} rejected={rejected} "
                    f"transport={transport} ws_frames={frames['count']}"
                )
            time.sleep(1.0)
    except KeyboardInterrupt:
        print(f"\n[python_demo] stopping — sent={sent} ws_frames={frames['count']}")
    finally:
        sub.stop()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
