"""Deals resource."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class DealsResource(BaseResource):
    def list(self, *, page: int = 1, per_page: int = 50) -> dict[str, Any]:
        return self._get("/deals", params={"page": page, "perPage": per_page})

    def get(self, deal_id: str) -> dict[str, Any]:
        return self._get(f"/deals/{deal_id}")

    def create(self, data: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        return self._post("/deals", json=data, idempotency_key=idempotency_key)

    def update(self, deal_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return self._patch(f"/deals/{deal_id}", json=data)

    def delete(self, deal_id: str) -> None:
        self._delete(f"/deals/{deal_id}")
