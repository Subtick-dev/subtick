"""Subtick canonical signing encoding (Python).

Mirrors :func:`subtick::types::transaction::UnsignedTransaction::encode`
byte-for-byte (`subtick/src/types/transaction.rs:179`). This is the exact
payload that ed25519 signs over — NOT the bincode wire format.

Layout (little-endian):
    version          2 B
    chain_id         4 B
    domain_id        4 B
    tx_type          2 B  ← explicit discriminant (Transfer = 1, Vm = 2)
    nonce            8 B
    sender_pubkey   32 B
    max_fee          8 B
    priority_fee     8 B
    gas_limit        8 B
    ttl              8 B
    scope_id         4 B   ← 0 means "no scope" (None), Some(0) is rejected
    read_set_count   2 B
    write_set_count  2 B
    read_set         read_set_count  × 32 B
    write_set        write_set_count × 32 B
    payload_len      4 B
    payload          payload_len B   (80 B fixed for Transfer)
"""

from __future__ import annotations

import hashlib
import struct
from typing import Iterable

# ── tx_type discriminants (canonical layer — match #[repr(u16)]) ─────────────
TX_TYPE_TRANSFER = 1
TX_TYPE_VM = 2

# ── ResourceType discriminants (for account_resource_id) ─────────────────────
_RESOURCE_TYPE_ACCOUNT = 1


def _check32(b: bytes, name: str) -> None:
    if len(b) != 32:
        raise ValueError(f"{name} must be 32 bytes (got {len(b)})")


def _u128_le(value: int) -> bytes:
    if value < 0 or value >= 1 << 128:
        raise ValueError(f"u128 out of range: {value}")
    return value.to_bytes(16, "little")


def encode_transfer_payload(recipient: bytes, asset_id: bytes, amount: int) -> bytes:
    """Build the 80-byte Transfer payload."""
    _check32(recipient, "recipient")
    _check32(asset_id, "asset_id")
    return recipient + asset_id + _u128_le(amount)


def encode_unsigned_canonical(
    *,
    version: int,
    chain_id: int,
    domain_id: int,
    tx_type: int,
    nonce: int,
    sender_pubkey: bytes,
    max_fee: int,
    priority_fee: int,
    gas_limit: int,
    ttl: int,
    scope_id: int | None,
    read_set: Iterable[bytes],
    write_set: Iterable[bytes],
    payload: bytes,
) -> bytes:
    """Encode an ``UnsignedTransaction`` into the canonical signing bytes."""
    _check32(sender_pubkey, "sender_pubkey")
    rs = list(read_set)
    ws = list(write_set)
    for r in rs:
        _check32(r, "read_set entry")
    for w in ws:
        _check32(w, "write_set entry")

    rs_count = min(len(rs), 0xFFFF)
    ws_count = min(len(ws), 0xFFFF)

    parts: list[bytes] = [
        struct.pack("<H", version),
        struct.pack("<I", chain_id),
        struct.pack("<I", domain_id),
        struct.pack("<H", tx_type),
        struct.pack("<Q", nonce),
        sender_pubkey,
        struct.pack("<Q", max_fee),
        struct.pack("<Q", priority_fee),
        struct.pack("<Q", gas_limit),
        struct.pack("<Q", ttl),
        struct.pack("<I", 0 if scope_id is None else scope_id),
        struct.pack("<H", rs_count),
        struct.pack("<H", ws_count),
    ]
    parts.extend(rs[:rs_count])
    parts.extend(ws[:ws_count])
    parts.append(struct.pack("<I", len(payload)))
    parts.append(payload)
    return b"".join(parts)


def account_resource_id(pubkey: bytes) -> bytes:
    """SHA256(ResourceType::Account u16 LE || pubkey).

    Mirrors :func:`subtick::scheduler::access::account_resource_id`.
    """
    _check32(pubkey, "pubkey")
    h = hashlib.sha256()
    h.update(struct.pack("<H", _RESOURCE_TYPE_ACCOUNT))
    h.update(pubkey)
    return h.digest()
