"""Subtick SDK — error classes.

Every error carries the underlying HTTP status (when applicable) and the
``retryable`` flag from the server response, so callers can implement their
own backoff policy without parsing error messages.
"""

from __future__ import annotations

from typing import Any


class SubtickError(Exception):
    """Base class for every error raised by the SDK."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        retryable: bool = False,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable
        self.body = body


class TxRejected(SubtickError):
    """Server returned a 4xx for ``POST /v1/tx``."""


class AccountNotFound(SubtickError):
    """404 on ``/v1/balance`` or ``/v1/account``."""

    def __init__(self, address: str) -> None:
        super().__init__(f"account not found: {address}", status=404, retryable=False)
        self.address = address


class TransportError(SubtickError):
    """Network failure, timeout, or malformed response."""

    def __init__(self, message: str, cause: BaseException | None = None) -> None:
        super().__init__(message, retryable=True)
        self.__cause__ = cause
