// BidStack Go SDK — quickstart example.
// Run: BIDSTACK_API_KEY=bsk_live_... go run ./examples/quickstart
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	bidstack "github.com/bidstack/bidstack-go"
)

func main() {
	apiKey := os.Getenv("BIDSTACK_API_KEY")
	if apiKey == "" {
		log.Fatal("BIDSTACK_API_KEY environment variable is not set")
	}

	client := bidstack.New(apiKey)
	ctx := context.Background()

	// --- List Leads ---
	leads, err := client.Leads.List(ctx, bidstack.LeadListParams{Page: 1, PerPage: 5})
	if err != nil {
		log.Fatalf("list leads: %v", err)
	}
	fmt.Printf("=== Leads (%d total) ===\n", leads.Meta.Total)
	for _, l := range leads.Data {
		fmt.Printf("  %s  %s  status=%s\n", l.ID, l.Name, l.Status)
	}

	// --- Create a Lead ---
	newLead, err := client.Leads.Create(ctx, map[string]any{
		"name":   "Go SDK Test Corp",
		"email":  "test@example.com",
		"source": "API",
	}, "go-quickstart-lead-001")
	if err != nil {
		log.Fatalf("create lead: %v", err)
	}
	fmt.Printf("\nCreated lead: %s\n", newLead.ID)

	// --- Opportunities ---
	opps, err := client.Opportunities.List(ctx, 1, 5, "")
	if err != nil {
		log.Fatalf("list opportunities: %v", err)
	}
	fmt.Printf("\n=== Opportunities (%d total) ===\n", opps.Meta.Total)
	for _, o := range opps.Data {
		fmt.Printf("  %s  %s  stage=%s\n", o.ID, o.Name, o.Stage)
	}

	// --- Register a Webhook ---
	wh, err := client.Webhooks.Create(ctx, map[string]any{
		"url":    "https://yourapp.example.com/hooks/bidstack",
		"events": []string{"lead.created", "deal.stage_change"},
	})
	if err != nil {
		log.Fatalf("create webhook: %v", err)
	}
	fmt.Printf("\nWebhook registered: %s\n", wh.ID)
}
