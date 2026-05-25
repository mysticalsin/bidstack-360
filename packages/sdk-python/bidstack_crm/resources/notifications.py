"""Notifications resource."""
from __future__ import annotations
from typing import Any
from ._base import BaseResource


class NotificationsResource(BaseResource):
    def list(self, *, unread_only: bool = False, page: int = 1, per_page: int = 50) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "perPage": per_page}
        if unread_only:
            params["unreadOnly"] = "true"
        return self._get("/notifications", params=params)

    def mark_read(self, notification_id: str) -> dict[str, Any]:
        return self._patch(f"/notifications/{notification_id}", json={"read": True})

    def mark_all_read(self) -> dict[str, Any]:
        return self._post("/notifications/mark-all-read")
