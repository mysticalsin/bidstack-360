"""Opportunities resource."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class OpportunitiesResource(BaseResource):
    def list(self, *, page: int = 1, per_page: int = 50, stage: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "perPage": per_page}
        if stage:
            params["stage"] = stage
        return self._get("/opportunities", params=params)

    def get(self, opportunity_id: str) -> dict[str, Any]:
        return self._get(f"/opportunities/{opportunity_id}")

    def create(self, data: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        return self._post("/opportunities", json=data, idempotency_key=idempotency_key)

    def update(self, opportunity_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return self._patch(f"/opportunities/{opportunity_id}", json=data)

    def delete(self, opportunity_id: str) -> None:
        self._delete(f"/opportunities/{opportunity_id}")

    def move_stage(self, opportunity_id: str, stage: str) -> dict[str, Any]:
        """Move an opportunity to a new pipeline stage."""
        return self._patch(f"/opportunities/{opportunity_id}", json={"stage": stage})
