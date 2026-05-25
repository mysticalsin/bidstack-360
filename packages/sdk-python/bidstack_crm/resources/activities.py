"""Activities resource."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class ActivitiesResource(BaseResource):
    def list(self, *, entity_type: str | None = None, entity_id: str | None = None, page: int = 1, per_page: int = 50) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "perPage": per_page}
        if entity_type:
            params["entityType"] = entity_type
        if entity_id:
            params["entityId"] = entity_id
        return self._get("/activities", params=params)

    def get(self, activity_id: str) -> dict[str, Any]:
        return self._get(f"/activities/{activity_id}")

    def create(self, data: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        return self._post("/activities", json=data, idempotency_key=idempotency_key)

    def update(self, activity_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return self._patch(f"/activities/{activity_id}", json=data)

    def delete(self, activity_id: str) -> None:
        self._delete(f"/activities/{activity_id}")
