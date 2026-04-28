"""Phase 1 Step 3 smoke for the Python SDK — mirror of the JS smoke."""

from __future__ import annotations

import os
import secrets
import sys
import time
from pathlib import Path

# Make the package importable without installing.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from subtick_sdk import (
    AccountNotFound,
    SubtickClient,
    build_signed_transfer,
    derive_public_key,
    subscribe_events,
)


def main() -> int:
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
    key_path = (
        sys.argv[2]
        if len(sys.argv) > 2
        else "../../subtick/testnet_real_smoke/keys/v0.key"
    )
    print(f"[smoke-py] base={base_url} key={key_path}")

    seed_hex = Path(key_path).read_text().strip()
    seed = bytes.fromhex(seed_hex)
    if len(seed) != 32:
        print(f"[smoke-py] expected 32-byte hex seed, got {len(seed)} bytes")
        return 2

    sender_pub = derive_public_key(seed)
    sender_hex = sender_pub.hex()
    print(f"[smoke-py] sender pubkey: {sender_hex}")

    client = SubtickClient(base_url=base_url)
    health = client.health()
    print(f"[smoke-py] api ok - height={health.height} slot={health.slot}")

    sender_before = client.get_account(sender_hex)
    print(f"[smoke-py] sender before - balance={sender_before.balance} nonce={sender_before.nonce}")

    recipient = secrets.token_bytes(32)
    recipient_hex = recipient.hex()
    amount = 100
    ttl = health.slot + 10_000

    tx_hex = build_signed_transfer(
        private_key=seed,
        sender_pubkey=sender_pub,
        recipient=recipient,
        amount=amount,
        nonce=sender_before.nonce,
        ttl=ttl,
    )
    print(
        f"[smoke-py] tx built - recipient={recipient_hex[:12]}... "
        f"amount={amount} nonce={sender_before.nonce} ttl={ttl} hex_len={len(tx_hex)}"
    )

    executed_frame: dict | None = None

    def on_event(event: dict) -> None:
        nonlocal executed_frame
        if event.get("type") != "BatchExecuted":
            return
        applied = int(event.get("group_applied_txs", 0))
        print(
            f"[ws] shard={event.get('shard_id')} applied={applied} "
            f"rej_nonce={event.get('group_rejected_nonce')} "
            f"rej_bal={event.get('group_rejected_balance')} "
            f"batch={str(event.get('batch_id', ''))[:12]}..."
        )
        if executed_frame is None and applied > 0:
            executed_frame = event

    sub = subscribe_events(base_url, on_event)
    time.sleep(0.25)

    try:
        submit = client.send_tx(tx_hex)
        print(f"[smoke-py] send_tx accepted: {submit.tx_hash}")
    except Exception as err:  # noqa: BLE001
        print(f"[smoke-py] send_tx FAILED: {err}")
        sub.stop()
        return 3

    if not submit.accepted:
        print(f"[smoke-py] expected accepted=True, got {submit}")
        sub.stop()
        return 4

    deadline = time.time() + 10.0
    while executed_frame is None and time.time() < deadline:
        time.sleep(0.1)

    if executed_frame is None:
        print("[smoke-py] no BatchExecuted (applied>0) frame in 10s")
        sub.stop()
        return 5

    time.sleep(0.5)  # let state apply settle
    sender_after = client.get_account(sender_hex)
    print(f"[smoke-py] sender after  - balance={sender_after.balance} nonce={sender_after.nonce}")

    try:
        recipient_after = client.get_account(recipient_hex)
        print(
            f"[smoke-py] recipient after - balance={recipient_after.balance} nonce={recipient_after.nonce}"
        )
        recipient_balance = recipient_after.balance
    except AccountNotFound:
        print("[smoke-py] recipient lookup: account not found")
        recipient_balance = 0

    balance_delta = sender_before.balance - sender_after.balance
    nonce_delta = sender_after.nonce - sender_before.nonce

    pass_count = 0
    fail_count = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal pass_count, fail_count
        if ok:
            pass_count += 1
            print(f"PASS {name}")
        else:
            fail_count += 1
            print(f"FAIL {name} :: {detail}")

    check("nonce incremented by 1", nonce_delta == 1, f"delta={nonce_delta}")
    check(
        "sender balance dropped by amount (v0 executor: no fee burn yet)",
        balance_delta == amount,
        f"delta={balance_delta} expected={amount}",
    )
    check(
        "recipient credited by amount",
        recipient_balance == amount,
        f"recipient={recipient_balance}",
    )
    check(
        "BatchExecuted applied>=1 frame received",
        executed_frame is not None,
        "<no frame>",
    )

    sub.stop()
    print(f"\nresult: {pass_count} pass, {fail_count} fail")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
