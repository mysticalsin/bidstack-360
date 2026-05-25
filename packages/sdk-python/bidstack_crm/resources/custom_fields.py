"""Custom fields resource."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class CustomFieldsResource(BaseResource):
    def list(self, entity_type: str) -> dict[str, Any]:
        """List custom field definitions for a given entity type."""
        return self._get("/custom-fields", params={"entityType": entity_type})

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        return self._post("/custom-fields", json=data)

    def update(self, field_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return self._patch(f"/custom-fields/{field_id}", json=data)

    def delete(self, field_id: str) -> None:
        self._delete(f"/custom-fields/{field_id}")
