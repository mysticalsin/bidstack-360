"""Leads resource — CRUD + list with filtering/pagination."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class LeadsResource(BaseResource):
    """Manage sales leads in BidStack 360°."""

    def list(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        status: str | None = None,
        assignee_id: str | None = None,
        q: str | None = None,
    ) -> dict[str, Any]:
        """
        List leads with optional filtering.

        Returns a paginated envelope: ``{"data": [...], "meta": {...}}``.
        """
        params: dict[str, Any] = {"page": page, "perPage": per_page}
        if status:
            params["status"] = status
        if assignee_id:
            params["assigneeId"] = assignee_id
        if q:
            params["q"] = q
        return self._get("/leads", params=params)

    def get(self, lead_id: str) -> dict[str, Any]:
        """Retrieve a single lead by ID."""
        return self._get(f"/leads/{lead_id}")

    def create(self, data: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        """
        Create a new lead.

        Required fields: ``name``, ``orgId``.
        Pass ``idempotency_key`` to make retries safe.
        """
        return self._post("/leads", json=data, idempotency_key=idempotency_key)

    def update(self, lead_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Partially update a lead (PATCH semantics)."""
        return self._patch(f"/leads/{lead_id}", json=data)

    def delete(self, lead_id: str) -> None:
        """Delete a lead permanently."""
        self._delete(f"/leads/{lead_id}")

    def convert(self, lead_id: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
        """Convert a lead to a contact/deal."""
        return self._post(f"/leads/{lead_id}/convert", json=data or {})
