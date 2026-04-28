"""Subtick SDK — transaction builder (Python).

Two-step pipeline:
    1. Compute the canonical signed bytes (:func:`encode_unsigned_canonical`).
    2. Sign with ed25519 over those bytes.
    3. Compose the wire Transaction (bincode).
    4. Hex-encode the wire.

Crypto via :mod:`cryptography.hazmat.primitives.asymmetric.ed25519`. Raw
32-byte seeds are imported with ``Ed25519PrivateKey.from_private_bytes``.
"""

from __future__ import annotations

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .bincode import encode_transaction_wire
from .canonical import (
    TX_TYPE_TRANSFER,
    account_resource_id,
    encode_transfer_payload,
    encode_unsigned_canonical,
)


# ── Protocol constants (mirror subtick/src/types/transaction.rs) ──────────────
TX_VERSION = 1
CHAIN_ID = 1
GAS_TRANSFER = 21_000
MIN_FEE = GAS_TRANSFER


def import_ed25519_private_key(seed: bytes) -> Ed25519PrivateKey:
    """Import a raw 32-byte Ed25519 seed."""
    if len(seed) != 32:
        raise ValueError(f"Ed25519 seed must be 32 bytes (got {len(seed)})")
    return Ed25519PrivateKey.from_private_bytes(seed)


def derive_public_key(seed: bytes) -> bytes:
    """Derive the 32-byte Ed25519 public key from a 32-byte seed."""
    priv = import_ed25519_private_key(seed)
    return priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )


def ed25519_sign(seed: bytes, message: bytes) -> bytes:
    """Sign ``message`` with the Ed25519 seed; returns 64 bytes."""
    return import_ed25519_private_key(seed).sign(message)


def build_signed_transfer(
    *,
    private_key: bytes,
    recipient: bytes,
    amount: int,
    nonce: int,
    ttl: int,
    sender_pubkey: bytes | None = None,
    chain_id: int = CHAIN_ID,
    domain_id: int = 0,
    max_fee: int = MIN_FEE,
    priority_fee: int = 0,
    gas_limit: int = GAS_TRANSFER,
    asset_id: bytes | None = None,
    shard_id: int = 0,
) -> str:
    """Build a signed Transfer transaction; return the hex blob ready for
    ``client.send_tx``.

    ``private_key`` and ``recipient`` are 32-byte ``bytes``. ``amount`` is an
    unbounded Python ``int`` (range-checked to u128).
    """
    if len(private_key) != 32:
        raise ValueError("private_key must be 32 bytes")
    if len(recipient) != 32:
        raise ValueError("recipient must be 32 bytes")
    if amount <= 0:
        raise ValueError("amount must be > 0")

    sender = sender_pubkey if sender_pubkey is not None else derive_public_key(private_key)
    if len(sender) != 32:
        raise ValueError("sender_pubkey must be 32 bytes")

    asset = asset_id if asset_id is not None else b"\x00" * 32

    payload = encode_transfer_payload(recipient, asset, amount)
    read_set = [account_resource_id(sender)]
    write_set = [account_resource_id(sender), account_resource_id(recipient)]

    canonical = encode_unsigned_canonical(
        version=TX_VERSION,
        chain_id=chain_id,
        domain_id=domain_id,
        tx_type=TX_TYPE_TRANSFER,
        nonce=nonce,
        sender_pubkey=sender,
        max_fee=max_fee,
        priority_fee=priority_fee,
        gas_limit=gas_limit,
        ttl=ttl,
        scope_id=None,
        read_set=read_set,
        write_set=write_set,
        payload=payload,
    )

    signature = ed25519_sign(private_key, canonical)
    if len(signature) != 64:
        # Should be impossible — `cryptography` is contract-bound to 64.
        raise RuntimeError(f"unexpected signature length: {len(signature)}")

    wire = encode_transaction_wire(
        inner=dict(
            version=TX_VERSION,
            chain_id=chain_id,
            domain_id=domain_id,
            tx_type=TX_TYPE_TRANSFER,
            nonce=nonce,
            sender_pubkey=sender,
            max_fee=max_fee,
            priority_fee=priority_fee,
            gas_limit=gas_limit,
            ttl=ttl,
            scope_id=None,
            read_set=read_set,
            write_set=write_set,
            payload_kind="Transfer",
            payload_inner=dict(recipient=recipient, asset_id=asset, amount=amount),
        ),
        signature=signature,
        shard_id=shard_id,
    )
    return wire.hex()
