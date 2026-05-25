"""Webhooks resource."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class WebhooksResource(BaseResource):
    def list(self) -> dict[str, Any]:
        return self._get("/webhooks")

    def get(self, webhook_id: str) -> dict[str, Any]:
        return self._get(f"/webhooks/{webhook_id}")

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        """Register a new webhook endpoint."""
        return self._post("/webhooks", json=data)

    def update(self, webhook_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return self._patch(f"/webhooks/{webhook_id}", json=data)

    def delete(self, webhook_id: str) -> None:
        self._delete(f"/webhooks/{webhook_id}")

    def test(self, webhook_id: str) -> dict[str, Any]:
        """Fire a test ping to verify the endpoint is reachable."""
        return self._post(f"/webhooks/{webhook_id}/test")
