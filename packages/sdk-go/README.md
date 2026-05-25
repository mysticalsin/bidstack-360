# BidStack CRM — Go SDK

Official Go client for the [BidStack 360° CRM API](https://docs.bidstack.io).

## Installation

```bash
go get github.com/bidstack/bidstack-go@v0.1.0
```

Requires Go 1.21+. Zero external dependencies — stdlib `net/http` only.

## Authentication

Generate an API key in **Settings → API Keys** inside the BidStack app.

```go
import bidstack "github.com/bidstack/bidstack-go"

client := bidstack.New(os.Getenv("BIDSTACK_API_KEY"))
```

Override base URL for on-prem / staging:

```go
client := bidstack.New(apiKey, bidstack.WithBaseURL("https://crm.company.com/api/v1"))
```

## Quickstart

```go
package main

import (
    "context"
    "fmt"
    "log"
    "os"

    bidstack "github.com/bidstack/bidstack-go"
)

func main() {
    client := bidstack.New(os.Getenv("BIDSTACK_API_KEY"))
    ctx := context.Background()

    // List leads
    leads, err := client.Leads.List(ctx, bidstack.LeadListParams{PerPage: 20, Status: "OPEN"})
    if err != nil {
        log.Fatal(err)
    }
    for _, l := range leads.Data {
        fmt.Println(l.ID, l.Name)
    }

    // Create a lead (safe to retry — Idempotency-Key auto-attached)
    newLead, err := client.Leads.Create(ctx, map[string]any{
        "name":  "ACME Corp",
        "email": "contact@acme.com",
    }, "my-workflow-id-step-1") // pass "" to auto-generate
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println("Created:", newLead.ID)

    // Move an opportunity stage
    _, err = client.Opportunities.MoveStage(ctx, "opp_abc123", "NEGOTIATION")
    if err != nil {
        log.Fatal(err)
    }
}
```

## Error Handling

```go
lead, err := client.Leads.Get(ctx, "lead_missing")
if err != nil {
    if bidstack.IsNotFound(err) {
        fmt.Println("Lead not found")
    } else if bidstack.IsAuthError(err) {
        fmt.Println("Check your API key")
    } else if bidstack.IsRateLimit(err) {
        apiErr := err.(*bidstack.APIError)
        fmt.Printf("Rate limited — retry after %.0fs\n", apiErr.RetryAfter)
    } else {
        log.Fatal(err)
    }
}
```

## Available Resources

| Resource | Type | Key Methods |
|---|---|---|
| `client.Leads` | `*LeadsResource` | `List`, `Get`, `Create`, `Update`, `Delete`, `Convert` |
| `client.Opportunities` | `*OpportunitiesResource` | `List`, `Get`, `Create`, `Update`, `Delete`, `MoveStage` |
| `client.Contacts` | `*ContactsResource` | `List`, `Get`, `Create`, `Update`, `Delete` |
| `client.Deals` | `*DealsResource` | `List`, `Get`, `Create`, `Update`, `Delete` |
| `client.Accounts` | `*AccountsResource` | `List`, `Get`, `Create`, `Update`, `Delete` |
| `client.Activities` | `*ActivitiesResource` | `List`, `Get`, `Create`, `Update`, `Delete` |
| `client.CustomFields` | `*CustomFieldsResource` | `List`, `Create`, `Update`, `Delete` |
| `client.CustomObjects` | `*CustomObjectsResource` | `ListSchemas`, `List`, `Get`, `Create`, `Update`, `Delete` |
| `client.Webhooks` | `*WebhooksResource` | `List`, `Get`, `Create`, `Update`, `Delete`, `Test` |
| `client.Notifications` | `*NotificationsResource` | `List`, `MarkRead`, `MarkAllRead` |

## Retry Behaviour

The SDK automatically retries HTTP 429 and 5xx with exponential backoff + full jitter. Default: 3 retries.

```go
client := bidstack.New(apiKey, bidstack.WithMaxRetries(5))
```

## Custom HTTP Client

```go
import "net/http"

hc := &http.Client{Timeout: 60 * time.Second}
client := bidstack.New(apiKey, bidstack.WithHTTPClient(hc))
```

## License

MIT — see [LICENSE](LICENSE).
