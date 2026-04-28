"""Subtick SDK — synchronous HTTP client.

Thin wrapper over the four Subtick API endpoints. No business logic, no
caching, no transaction building. Callers pass pre-encoded ``tx_hex`` (hex
of bincode of ``Transaction``) and receive every server-side field unchanged.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import requests

from .errors import AccountNotFound, SubtickError, TransportError, TxRejected


DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_TIMEOUT_S = 5.0


@dataclass(frozen=True)
class TxResult:
    """Successful submit response."""

    accepted: bool
    tx_hash: str | None
    reason: str | None
    retryable: bool


@dataclass(frozen=True)
class Account:
    """Read-out of an account's full state."""

    address: str
    balance: int  # parsed from u128 decimal string — Python ints are unbounded
    nonce: int


@dataclass(frozen=True)
class Health:
    status: str
    height: int
    slot: int
    account_count: int


class SubtickClient:
    """Synchronous Subtick API client."""

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        session: requests.Session | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._session = session or requests.Session()

    # ── tx submission ────────────────────────────────────────────────────

    def send_tx(self, tx_hex: str) -> TxResult:
        """Submit a signed transaction.

        ``tx_hex`` is the hex-encoded bincode of ``Transaction``. The SDK does
        NOT build / sign / encode — the caller supplies the wire-ready blob.

        Raises:
            TxRejected: server returned a 4xx. Inspect ``.retryable`` to
                decide whether to backoff and resubmit the same body.
            TransportError: network failure or timeout.
        """
        if not isinstance(tx_hex, str) or not tx_hex:
            raise SubtickError("tx_hex must be a non-empty hex string", retryable=False)
        res = self._http("POST", "/v1/tx", {"tx": tx_hex})
        body = self._json(res)
        result = TxResult(
            accepted=bool(body.get("accepted")),
            tx_hash=body.get("tx_hash"),
            reason=body.get("reason"),
            retryable=bool(body.get("retryable")),
        )
        if not result.accepted:
            raise TxRejected(
                result.reason or f"tx rejected (HTTP {res.status_code})",
                status=res.status_code,
                retryable=result.retryable,
                body=result,
            )
        return result

    # ── reads ────────────────────────────────────────────────────────────

    def get_balance(self, address: str) -> int:
        """Return the account balance as a Python int (lossless)."""
        res = self._http("GET", f"/v1/balance/{address}")
        if res.status_code == 404:
            raise AccountNotFound(address)
        body = self._json(res)
        if not res.ok:
            raise SubtickError(
                body.get("error") or f"balance lookup failed (HTTP {res.status_code})",
                status=res.status_code,
                retryable=res.status_code >= 500,
                body=body,
            )
        return int(body["balance"])

    def get_account(self, address: str) -> Account:
        """Return balance + nonce."""
        res = self._http("GET", f"/v1/account/{address}")
        if res.status_code == 404:
            raise AccountNotFound(address)
        body = self._json(res)
        if not res.ok:
            raise SubtickError(
                body.get("error") or f"account lookup failed (HTTP {res.status_code})",
                status=res.status_code,
                retryable=res.status_code >= 500,
                body=body,
            )
        return Account(
            address=body["address"],
            balance=int(body["balance"]),
            nonce=int(body["nonce"]),
        )

    def health(self) -> Health:
        """Liveness probe."""
        res = self._http("GET", "/health")
        body = self._json(res)
        if not res.ok:
            raise SubtickError(
                f"health check failed (HTTP {res.status_code})",
                status=res.status_code,
                retryable=True,
                body=body,
            )
        return Health(
            status=body["status"],
            height=int(body["height"]),
            slot=int(body["slot"]),
            account_count=int(body["account_count"]),
        )

    # ── internals ────────────────────────────────────────────────────────

    def _http(self, method: str, path: str, body: dict[str, Any] | None = None) -> requests.Response:
        try:
            return self._session.request(
                method,
                f"{self.base_url}{path}",
                json=body,
                timeout=self.timeout_s,
            )
        except requests.Timeout as e:
            raise TransportError(f"request timed out after {self.timeout_s}s", e) from e
        except requests.ConnectionError as e:
            raise TransportError(f"connection failed: {e}", e) from e
        except requests.RequestException as e:
            raise TransportError(f"request failed: {e}", e) from e

    def _json(self, res: requests.Response) -> dict[str, Any]:
        if not res.text:
            return {}
        try:
            return res.json()
        except json.JSONDecodeError as e:
            raise TransportError(
                f"malformed JSON response (HTTP {res.status_code}): {res.text[:100]}",
                e,
            ) from e
