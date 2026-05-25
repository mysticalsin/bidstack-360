# BidStack CRM — Ruby SDK

Official Ruby client for the [BidStack 360° CRM API](https://docs.bidstack.io).

## Installation

Add to your `Gemfile`:

```ruby
gem "bidstack_crm", "~> 0.1"
```

Or install directly:

```bash
gem install bidstack_crm
```

Requires Ruby 3.1+.

## Authentication

Generate an API key in **Settings → API Keys** inside the BidStack app.

```ruby
require "bidstack_crm"

client = BidstackCrm::Client.new(api_key: ENV["BIDSTACK_API_KEY"])
```

## Quickstart

```ruby
require "bidstack_crm"

client = BidstackCrm::Client.new(api_key: ENV["BIDSTACK_API_KEY"])

# List leads
result = client.leads.list(per_page: 20, status: "OPEN")
result["data"].each { |l| puts "#{l["id"]}: #{l["name"]}" }

# Create a lead (safe to retry — Idempotency-Key auto-attached)
new_lead = client.leads.create(
  { name: "ACME Corp", email: "contact@acme.com", source: "REFERRAL" },
  idempotency_key: "my-workflow-run-step-1"
)
puts "Created: #{new_lead["id"]}"

# Move an opportunity through the pipeline
client.opportunities.move_stage("opp_abc123", "NEGOTIATION")

# Register a webhook
client.webhooks.create(
  url: "https://yourapp.com/hooks/bidstack",
  events: ["lead.created", "deal.stage_change"]
)
```

## Error Handling

```ruby
begin
  lead = client.leads.find("lead_does_not_exist")
rescue BidstackCrm::AuthenticationError
  puts "Check your API key"
rescue BidstackCrm::NotFoundError
  puts "Lead not found"
rescue BidstackCrm::RateLimitError => e
  puts "Rate limited — retry after #{e.retry_after}s"
rescue BidstackCrm::ValidationError => e
  e.errors.each { |err| puts "#{err["field"]}: #{err["message"]}" }
rescue BidstackCrm::ServerError
  puts "Server error — try again later"
end
```

## Available Resources

| Resource | Methods |
|---|---|
| `client.leads` | `list`, `find`, `create`, `update`, `destroy`, `convert` |
| `client.opportunities` | `list`, `find`, `create`, `update`, `destroy`, `move_stage` |
| `client.contacts` | `list`, `find`, `create`, `update`, `destroy` |
| `client.deals` | `list`, `find`, `create`, `update`, `destroy` |
| `client.accounts` | `list`, `find`, `create`, `update`, `destroy` |
| `client.activities` | `list`, `find`, `create`, `update`, `destroy` |
| `client.custom_fields` | `list`, `create`, `update`, `destroy` |
| `client.custom_objects` | `list_schemas`, `list`, `find`, `create`, `update`, `destroy` |
| `client.webhooks` | `list`, `find`, `create`, `update`, `destroy`, `test` |
| `client.notifications` | `list`, `mark_read`, `mark_all_read` |

## Retry Behaviour

The SDK automatically retries HTTP 429 and 5xx with exponential backoff via `faraday-retry`. Default: 3 retries.

```ruby
client = BidstackCrm::Client.new(api_key: "...", max_retries: 5)
```

## Development

```bash
bundle install
bundle exec rspec spec/
```

## License

MIT — see [LICENSE](LICENSE).
