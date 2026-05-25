"""
BidStack 360° Python SDK

Quickstart:
    from bidstack_crm import BidStackClient

    client = BidStackClient(api_key="bsk_live_...")
    leads = client.leads.list()
"""

from .client import BidStackClient
from .errors import (
    BidStackError,
    AuthenticationError,
    NotFoundError,
    RateLimitError,
    ValidationError,
    ServerError,
)

__all__ = [
    "BidStackClient",
    "BidStackError",
    "AuthenticationError",
    "NotFoundError",
    "RateLimitError",
    "ValidationError",
    "ServerError",
]

__version__ = "0.1.0"
