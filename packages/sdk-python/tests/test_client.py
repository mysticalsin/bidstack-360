"""
Tests for BidStackClient — uses respx to mock HTTP without a real server.

WHY mock-server pattern: we need deterministic tests that don't depend on
network state; respx intercepts httpx transport so we test the exact wire
format the SDK produces.
"""

import pytest
import respx
import httpx

from bidstack_crm import BidStackClient
from bidstack_crm.errors import AuthenticationError, NotFoundError, RateLimitError, ValidationError


BASE = "https://api.bidstack.io/v1"


@pytest.fixture
def client() -> BidStackClient:
    return BidStackClient(api_key="bsk_test_abc123", max_retries=0)


@respx.mock
def test_list_leads_sends_bearer_token(client: BidStackClient) -> None:
    """SDK must attach Authorization: Bearer header on every request."""
    route = respx.get(f"{BASE}/leads").mock(
        return_value=httpx.Response(200, json={"data": [], "meta": {"total": 0}})
    )
    client.leads.list()
    assert route.called
    assert route.calls[0].request.headers["Authorization"] == "Bearer bsk_test_abc123"


@respx.mock
def test_list_leads_pagination_params(client: BidStackClient) -> None:
    """SDK must forward page/perPage as query params."""
    route = respx.get(f"{BASE}/leads").mock(
        return_value=httpx.Response(200, json={"data": [], "meta": {}})
    )
    client.leads.list(page=2, per_page=25)
    assert "page=2" in str(route.calls[0].request.url)
    assert "perPage=25" in str(route.calls[0].request.url)


@respx.mock
def test_create_lead_sets_idempotency_key(client: BidStackClient) -> None:
    """POST must include auto-generated Idempotency-Key."""
    route = respx.post(f"{BASE}/leads").mock(
        return_value=httpx.Response(201, json={"id": "lead_1", "name": "ACME"})
    )
    client.leads.create({"name": "ACME", "orgId": "org_1"})
    assert "Idempotency-Key" in route.calls[0].request.headers


@respx.mock
def test_create_lead_explicit_idempotency_key(client: BidStackClient) -> None:
    """Caller-supplied idempotency key must be forwarded as-is."""
    route = respx.post(f"{BASE}/leads").mock(
        return_value=httpx.Response(201, json={"id": "lead_2"})
    )
    client.leads.create({"name": "Beta"}, idempotency_key="my-custom-key-xyz")
    assert route.calls[0].request.headers["Idempotency-Key"] == "my-custom-key-xyz"


@respx.mock
def test_401_raises_authentication_error(client: BidStackClient) -> None:
    """HTTP 401 must raise AuthenticationError."""
    respx.get(f"{BASE}/leads").mock(return_value=httpx.Response(401, json={"message": "Unauthorized"}))
    with pytest.raises(AuthenticationError):
        client.leads.list()


@respx.mock
def test_404_raises_not_found(client: BidStackClient) -> None:
    """HTTP 404 must raise NotFoundError."""
    respx.get(f"{BASE}/leads/missing").mock(return_value=httpx.Response(404, json={"message": "Not found"}))
    with pytest.raises(NotFoundError):
        client.leads.get("missing")


@respx.mock
def test_422_raises_validation_error_with_errors(client: BidStackClient) -> None:
    """HTTP 422 must raise ValidationError and expose field errors."""
    respx.post(f"{BASE}/leads").mock(
        return_value=httpx.Response(422, json={"message": "Validation failed", "errors": [{"field": "name", "message": "required"}]})
    )
    with pytest.raises(ValidationError) as exc_info:
        client.leads.create({})
    assert exc_info.value.errors[0]["field"] == "name"


@respx.mock
def test_429_raises_rate_limit_error(client: BidStackClient) -> None:
    """HTTP 429 (with retries exhausted) must raise RateLimitError."""
    respx.get(f"{BASE}/leads").mock(return_value=httpx.Response(429, json={"message": "Too many requests"}, headers={"Retry-After": "1"}))
    with pytest.raises(RateLimitError):
        client.leads.list()


@respx.mock
def test_context_manager_closes_client(tmp_path) -> None:
    """Client used as context manager must close the httpx session cleanly."""
    respx.get(f"{BASE}/leads").mock(return_value=httpx.Response(200, json={"data": [], "meta": {}}))
    with BidStackClient(api_key="bsk_test_ctx", max_retries=0) as c:
        c.leads.list()
    # Verifying no exception on context exit — httpx client is closed


@respx.mock
def test_get_opportunity(client: BidStackClient) -> None:
    """GET /opportunities/:id must map correctly."""
    respx.get(f"{BASE}/opportunities/opp_1").mock(
        return_value=httpx.Response(200, json={"id": "opp_1", "stage": "PROPOSAL"})
    )
    result = client.opportunities.get("opp_1")
    assert result["stage"] == "PROPOSAL"


@respx.mock
def test_webhook_test_endpoint(client: BidStackClient) -> None:
    """Webhook test helper must POST to the correct endpoint."""
    route = respx.post(f"{BASE}/webhooks/wh_1/test").mock(
        return_value=httpx.Response(200, json={"delivered": True})
    )
    result = client.webhooks.test("wh_1")
    assert route.called
    assert result["delivered"] is True
