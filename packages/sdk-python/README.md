# BidStack CRM — Python SDK

Official Python client for the [BidStack 360° CRM API](https://docs.bidstack.io).

## Installation

```bash
pip install bidstack-crm
```

Requires Python 3.9+.

## Authentication

All API calls require a bearer token. Generate one in **Settings → API Keys** inside the BidStack app.

```python
from bidstack_crm import BidStackClient

client = BidStackClient(api_key="bsk_live_YOUR_KEY_HERE")
```

For on-premises deployments:

```python
client = BidStackClient(
    api_key="bsk_live_...",
    base_url="https://crm.your-company.com/api/v1",
)
```

## Quickstart

```python
from bidstack_crm import BidStackClient

client = BidStackClient(api_key="bsk_live_...")

# List the first 20 open leads
response = client.leads.list(per_page=20, status="OPEN")
for lead in response["data"]:
    print(lead["name"], lead["id"])

# Create a lead (auto-generates Idempotency-Key)
new_lead = client.leads.create({
    "name": "ACME Corp",
    "email": "contact@acme.com",
    "source": "REFERRAL",
})
print("Created:", new_lead["id"])

# Move an opportunity stage
client.opportunities.move_stage("opp_abc123", stage="NEGOTIATION")

# Register a webhook
client.webhooks.create({
    "url": "https://yourapp.com/hooks/bidstack",
    "events": ["lead.created", "deal.stage_change"],
})
```

## Available Resources

| Resource | Methods |
|---|---|
| `client.leads` | `list`, `get`, `create`, `update`, `delete`, `convert` |
| `client.opportunities` | `list`, `get`, `create`, `update`, `delete`, `move_stage` |
| `client.contacts` | `list`, `get`, `create`, `update`, `delete` |
| `client.deals` | `list`, `get`, `create`, `update`, `delete` |
| `client.accounts` | `list`, `get`, `create`, `update`, `delete` |
| `client.activities` | `list`, `get`, `create`, `update`, `delete` |
| `client.custom_fields` | `list`, `create`, `update`, `delete` |
| `client.custom_objects` | `list_schemas`, `list`, `get`, `create`, `update`, `delete` |
| `client.webhooks` | `list`, `get`, `create`, `update`, `delete`, `test` |
| `client.notifications` | `list`, `mark_read`, `mark_all_read` |

## Error Handling

```python
from bidstack_crm import BidStackClient
from bidstack_crm.errors import AuthenticationError, NotFoundError, RateLimitError, ValidationError

client = BidStackClient(api_key="bsk_live_...")

try:
    lead = client.leads.get("lead_does_not_exist")
except AuthenticationError:
    print("Check your API key")
except NotFoundError:
    print("Lead not found")
except RateLimitError as e:
    print(f"Rate limited — retry after {e.retry_after}s")
except ValidationError as e:
    for err in e.errors:
        print(err["field"], err["message"])
```

## Retry Behaviour

The SDK automatically retries HTTP 429 and 5xx responses with **exponential backoff + full jitter**. Default: 3 retries. Override:

```python
client = BidStackClient(api_key="...", max_retries=5)
```

## Idempotency

Every `POST` and `PATCH` automatically includes a random `Idempotency-Key` header so safe retries never create duplicates. Override:

```python
client.leads.create(data, idempotency_key="my-workflow-run-id-step-3")
```

## Context Manager

```python
with BidStackClient(api_key="bsk_live_...") as client:
    leads = client.leads.list()
# HTTP session is closed automatically
```

## Development

```bash
pip install -e ".[dev]"
pytest tests/
ruff check bidstack_crm/
```

## License

MIT — see [LICENSE](LICENSE).
