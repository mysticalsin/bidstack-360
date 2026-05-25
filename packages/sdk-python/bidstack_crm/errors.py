"""Typed error hierarchy for the BidStack Python SDK."""

from typing import Any


class BidStackError(Exception):
    """Base class for all BidStack SDK errors."""

    def __init__(self, message: str, status_code: int | None = None, body: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class AuthenticationError(BidStackError):
    """Raised when the API key is missing or invalid (HTTP 401)."""


class NotFoundError(BidStackError):
    """Raised when the requested resource does not exist (HTTP 404)."""


class RateLimitError(BidStackError):
    """Raised when the rate limit is exceeded (HTTP 429)."""

    def __init__(self, message: str, retry_after: float | None = None, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        # seconds until the client may retry
        self.retry_after = retry_after


class ValidationError(BidStackError):
    """Raised when the API rejects input (HTTP 422)."""

    def __init__(self, message: str, errors: list[dict[str, Any]] | None = None, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        self.errors = errors or []


class ServerError(BidStackError):
    """Raised for unexpected server-side failures (HTTP 5xx)."""
