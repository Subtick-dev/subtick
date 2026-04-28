"""Minimal bincode 1.x encoder for the wire ``Transaction`` shape (Python).

Bincode 1.x default config (matches subtick Cargo.toml ``bincode = "1"``):
    - little-endian
    - fixed-int encoding (no varint)
    - ``Vec<T>`` / ``serialize_bytes`` prefix length as 8-byte u64 LE
    - ``[u8; N]`` → N raw bytes (no length prefix)
    - ``enum`` → 4-byte u32 LE **variant index** (0-based, NOT the explicit
      ``#[repr]`` discriminant — important for ``TxType`` and ``TxPayload``)
    - ``Option`` → 1-byte tag (0 = None, 1 = Some) followed by T if Some
"""

from __future__ import annotations

import struct
from typing import Iterable

# ── bincode variant indices (NOT the canonical discriminants!) ──────────────
_TX_TYPE_VARIANT_TRANSFER = 0
_TX_TYPE_VARIANT_VM = 1

_TX_PAYLOAD_VARIANT_TRANSFER = 0
_TX_PAYLOAD_VARIANT_VM = 1


def _u8(v: int) -> bytes:
    return struct.pack("<B", v)


def _u16(v: int) -> bytes:
    return struct.pack("<H", v)


def _u32(v: int) -> bytes:
    return struct.pack("<I", v)


def _u64(v: int) -> bytes:
    return struct.pack("<Q", v)


def _u128(v: int) -> bytes:
    if v < 0 or v >= 1 << 128:
        raise ValueError(f"u128 out of range: {v}")
    return v.to_bytes(16, "little")


def _vec_len(n: int) -> bytes:
    """Vec<T> length prefix: 8-byte u64 LE (matches serialize_bytes)."""
    return _u64(n)


def _bytes_prefixed(b: bytes) -> bytes:
    """``serialize_bytes(&[u8])`` — same prefix as ``Vec<u8>``."""
    return _vec_len(len(b)) + b


def encode_transaction_wire(
    *,
    inner: dict,
    signature: bytes,
    shard_id: int = 0,
) -> bytes:
    """Bincode-encode the wire ``Transaction`` exactly as the API expects.

    ``inner`` keys mirror :func:`encode_unsigned_bincode` parameters.
    """
    if len(signature) != 64:
        raise ValueError(f"signature must be 64 bytes (got {len(signature)})")
    return (
        _encode_unsigned_bincode(**inner)
        + _bytes_prefixed(signature)
        + _u8(shard_id & 0xFF)
    )


def _encode_unsigned_bincode(
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
    payload_kind: str,
    payload_inner: dict,
) -> bytes:
    if len(sender_pubkey) != 32:
        raise ValueError("sender_pubkey must be 32 bytes")

    if tx_type == 1:
        type_variant = _TX_TYPE_VARIANT_TRANSFER
    elif tx_type == 2:
        type_variant = _TX_TYPE_VARIANT_VM
    else:
        raise ValueError(f"unknown tx_type {tx_type}")

    rs = list(read_set)
    ws = list(write_set)
    for r in rs:
        if len(r) != 32:
            raise ValueError("read_set entry must be 32 bytes")
    for w in ws:
        if len(w) != 32:
            raise ValueError("write_set entry must be 32 bytes")

    parts: list[bytes] = [
        _u16(version),
        _u32(chain_id),
        _u32(domain_id),
        _u32(type_variant),
        _u64(nonce),
        sender_pubkey,
        _u64(max_fee),
        _u64(priority_fee),
        _u64(gas_limit),
        _u64(ttl),
    ]
    if scope_id is None:
        parts.append(_u8(0))
    else:
        parts.append(_u8(1))
        parts.append(_u32(scope_id))

    parts.append(_vec_len(len(rs)))
    parts.extend(rs)
    parts.append(_vec_len(len(ws)))
    parts.extend(ws)

    parts.append(_encode_payload(payload_kind, payload_inner))
    return b"".join(parts)


def _encode_payload(kind: str, inner: dict) -> bytes:
    if kind == "Transfer":
        recipient = inner["recipient"]
        asset_id = inner["asset_id"]
        amount = inner["amount"]
        if len(recipient) != 32:
            raise ValueError("recipient must be 32 bytes")
        if len(asset_id) != 32:
            raise ValueError("asset_id must be 32 bytes")
        return _u32(_TX_PAYLOAD_VARIANT_TRANSFER) + recipient + asset_id + _u128(amount)
    if kind == "Vm":
        accounts = list(inner["accounts"])
        bytecode = inner["bytecode"]
        for a in accounts:
            if len(a) != 32:
                raise ValueError("vm account must be 32 bytes")
        out = _u32(_TX_PAYLOAD_VARIANT_VM) + _vec_len(len(accounts))
        out += b"".join(accounts)
        out += _vec_len(len(bytecode)) + bytecode
        return out
    raise ValueError(f"unknown payload_kind {kind}")
