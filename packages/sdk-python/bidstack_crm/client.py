"""
BidStack HTTP client — bearer-token auth, idempotency-key support,
exponential backoff with jitter for 429/5xx.
"""

from __future__ import annotations

import time
import random
import uuid
from typing import Any

import httpx

from .errors import (
    AuthenticationError,
    BidStackError,
    NotFoundError,
    RateLimitError,
    ServerError,
    ValidationError,
)
from .resources.leads import LeadsResource
from .resources.opportunities import OpportunitiesResource
from .resources.contacts import ContactsResource
from .resources.deals import DealsResource
from .resources.accounts import AccountsResource
from .resources.activities import ActivitiesResource
from .resources.custom_fields import CustomFieldsResource
from .resources.custom_objects import CustomObjectsResource
from .resources.webhooks import WebhooksResource
from .resources.notifications import NotificationsResource

DEFAULT_BASE_URL = "https://api.bidstack.io/v1"
DEFAULT_TIMEOUT = 30.0
MAX_RETRIES = 3
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class BidStackClient:
    """
    Entry-point for the BidStack 360° API.

    Args:
        api_key: Bearer token (``bsk_live_...`` or ``bsk_test_...``).
        base_url: Override for on-prem / staging deployments.
        timeout: Request timeout in seconds.
        max_retries: Maximum automatic retries on transient errors.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        if not api_key:
            raise ValueError("api_key must not be empty")

        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._max_retries = max_retries

        self._http = httpx.Client(
            base_url=self._base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "User-Agent": "bidstack-python/0.1.0",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

        # Resource accessors — each is a thin wrapper around _request
        self.leads = LeadsResource(self)
        self.opportunities = OpportunitiesResource(self)
        self.contacts = ContactsResource(self)
        self.deals = DealsResource(self)
        self.accounts = AccountsResource(self)
        self.activities = ActivitiesResource(self)
        self.custom_fields = CustomFieldsResource(self)
        self.custom_objects = CustomObjectsResource(self)
        self.webhooks = WebhooksResource(self)
        self.notifications = NotificationsResource(self)

    # ------------------------------------------------------------------
    # Internal request helper
    # ------------------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        idempotency_key: str | None = None,
    ) -> Any:
        """
        Execute a request with automatic retry + exponential backoff.

        WHY idempotency_key header: POST/PATCH mutations may be retried
        on network failure; the server deduplicates using this key so
        clients never create duplicate records.
        """
        headers: dict[str, str] = {}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        elif method.upper() in {"POST", "PATCH", "PUT"}:
            # Auto-generate a key so retries are safe by default
            headers["Idempotency-Key"] = str(uuid.uuid4())

        attempt = 0
        while True:
            try:
                resp = self._http.request(
                    method,
                    path,
                    params=params,
                    json=json,
                    headers=headers,
                )
            except httpx.TimeoutException as exc:
                if attempt < self._max_retries:
                    self._backoff(attempt)
                    attempt += 1
                    continue
                raise BidStackError(f"Request timed out after {self._max_retries} retries") from exc

            if resp.status_code < 400:
                if resp.content:
                    return resp.json()
                return None

            # Parse error body if JSON, else fall back to text
            try:
                body = resp.json()
                message = body.get("message") or body.get("error") or resp.text
            except Exception:
                body = None
                message = resp.text

            status = resp.status_code

            if status in _RETRYABLE_STATUS and attempt < self._max_retries:
                retry_after = None
                if status == 429:
                    retry_after_hdr = resp.headers.get("Retry-After")
                    retry_after = float(retry_after_hdr) if retry_after_hdr else None
                self._backoff(attempt, retry_after)
                attempt += 1
                continue

            self._raise_for_status(status, message, body)

    def _backoff(self, attempt: int, override_seconds: float | None = None) -> None:
        """Exponential backoff with full jitter, or server-dictated delay."""
        if override_seconds is not None:
            time.sleep(override_seconds)
            return
        # Full jitter: sleep in [0, base * 2^attempt]
        base = min(60.0, 0.5 * (2 ** attempt))
        time.sleep(random.uniform(0, base))

    @staticmethod
    def _raise_for_status(status: int, message: str, body: Any) -> None:
        if status == 401:
            raise AuthenticationError(message, status_code=status, body=body)
        if status == 404:
            raise NotFoundError(message, status_code=status, body=body)
        if status == 422:
            errors = body.get("errors") if isinstance(body, dict) else None
            raise ValidationError(message, errors=errors, status_code=status, body=body)
        if status == 429:
            raise RateLimitError(message, status_code=status, body=body)
        if status >= 500:
            raise ServerError(message, status_code=status, body=body)
        raise BidStackError(message, status_code=status, body=body)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "BidStackClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
