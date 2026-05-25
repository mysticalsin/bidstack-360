"""Contacts resource."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class ContactsResource(BaseResource):
    def list(self, *, page: int = 1, per_page: int = 50, q: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "perPage": per_page}
        if q:
            params["q"] = q
        return self._get("/contacts", params=params)

    def get(self, contact_id: str) -> dict[str, Any]:
        return self._get(f"/contacts/{contact_id}")

    def create(self, data: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        return self._post("/contacts", json=data, idempotency_key=idempotency_key)

    def update(self, contact_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return self._patch(f"/contacts/{contact_id}", json=data)

    def delete(self, contact_id: str) -> None:
        self._delete(f"/contacts/{contact_id}")
