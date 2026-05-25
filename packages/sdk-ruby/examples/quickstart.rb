#!/usr/bin/env ruby
# frozen_string_literal: true
#
# BidStack Ruby SDK — quickstart example.
# Run with: BIDSTACK_API_KEY=bsk_live_... ruby examples/quickstart.rb

require "bidstack_crm"

client = BidstackCrm::Client.new(api_key: ENV.fetch("BIDSTACK_API_KEY"))

# --- Leads ---
puts "=== Leads ==="
result = client.leads.list(per_page: 5)
result["data"].each { |l| puts "  #{l["id"]}  #{l["name"]}" }

# Create a lead (idempotency key ensures no duplicate on retry)
new_lead = client.leads.create(
  { name: "Example Corp", email: "hello@example.com", source: "API" },
  idempotency_key: "quickstart-example-lead-001"
)
puts "Created lead: #{new_lead["id"]}"

# --- Opportunities ---
puts "\n=== Opportunities ==="
opps = client.opportunities.list(per_page: 5)
opps["data"].each { |o| puts "  #{o["id"]}  #{o["name"]}  stage=#{o["stage"]}" }

# --- Webhooks ---
puts "\n=== Webhooks ==="
webhook = client.webhooks.create(
  url: "https://yourapp.example.com/hooks/bidstack",
  events: ["lead.created", "deal.stage_change"]
)
puts "Webhook registered: #{webhook["id"]}"
puts "Testing delivery..."
test_result = client.webhooks.test(webhook["id"])
puts "Delivered: #{test_result["delivered"]}"
