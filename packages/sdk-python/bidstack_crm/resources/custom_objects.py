"""Custom objects resource."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class CustomObjectsResource(BaseResource):
    def list_schemas(self) -> dict[str, Any]:
        """List all custom object type schemas in the org."""
        return self._get("/custom-objects/schemas")

    def list(self, object_type: str, *, page: int = 1, per_page: int = 50) -> dict[str, Any]:
        return self._get(f"/custom-objects/{object_type}", params={"page": page, "perPage": per_page})

    def get(self, object_type: str, record_id: str) -> dict[str, Any]:
        return self._get(f"/custom-objects/{object_type}/{record_id}")

    def create(self, object_type: str, data: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
        return self._post(f"/custom-objects/{object_type}", json=data, idempotency_key=idempotency_key)

    def update(self, object_type: str, record_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return self._patch(f"/custom-objects/{object_type}/{record_id}", json=data)

    def delete(self, object_type: str, record_id: str) -> None:
        self._delete(f"/custom-objects/{object_type}/{record_id}")
