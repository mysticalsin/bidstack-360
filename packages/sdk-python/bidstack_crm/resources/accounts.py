"""Accounts resource."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class AccountsResource(BaseResource):
    def list(self, *, page: int = 1, per_page: int = 50) -> dict[str, Any]:
        return self._get("/accounts", params={"page": page, "perPage": per_page})

    def get(self, account_id: str) -> dict[str, Any]:
        return self._get(f"/accounts/{account_id}")

    def create(self, data: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        return self._post("/accounts", json=data, idempotency_key=idempotency_key)

    def update(self, account_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return self._patch(f"/accounts/{account_id}", json=data)

    def delete(self, account_id: str) -> None:
        self._delete(f"/accounts/{account_id}")
