"""Shared base for all resource classes."""
from __future__ import annotations
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..client import BidStackClient


class BaseResource:
    def __init__(self, client: "BidStackClient") -> None:
        self._client = client

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return self._client._request("GET", path, params=params)

    def _post(self, path: str, json: Any = None, idempotency_key: str | None = None) -> Any:
        return self._client._request("POST", path, json=json, idempotency_key=idempotency_key)

    def _patch(self, path: str, json: Any = None, idempotency_key: str | None = None) -> Any:
        return self._client._request("PATCH", path, json=json, idempotency_key=idempotency_key)

    def _delete(self, path: str) -> Any:
        return self._client._request("DELETE", path)
