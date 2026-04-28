"""subtick_sdk — thin Python wrapper for the Subtick HTTP/WS API (Phase 1)."""

from .client import Account, SubtickClient, Health, TxResult
from .errors import AccountNotFound, SubtickError, TransportError, TxRejected
from .events import EventSubscription, subscribe_events
from .tx_builder import (
    CHAIN_ID,
    GAS_TRANSFER,
    MIN_FEE,
    TX_VERSION,
    build_signed_transfer,
    derive_public_key,
    ed25519_sign,
    import_ed25519_private_key,
)

__all__ = [
    "SubtickClient",
    "Account",
    "Health",
    "TxResult",
    "EventSubscription",
    "subscribe_events",
    "SubtickError",
    "AccountNotFound",
    "TransportError",
    "TxRejected",
    "build_signed_transfer",
    "derive_public_key",
    "ed25519_sign",
    "import_ed25519_private_key",
    "TX_VERSION",
    "CHAIN_ID",
    "GAS_TRANSFER",
    "MIN_FEE",
]

__version__ = "0.1.0"
