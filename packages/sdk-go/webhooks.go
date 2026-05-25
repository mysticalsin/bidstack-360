package bidstack

import (
	"context"
	"fmt"
)

// Webhook represents a registered webhook endpoint.
type Webhook struct {
	ID     string   `json:"id"`
	URL    string   `json:"url"`
	Events []string `json:"events"`
	Active bool     `json:"active"`
	OrgID  string   `json:"orgId"`
}

// WebhooksResource exposes webhook management operations.
type WebhooksResource struct {
	client *Client
}

func (r *WebhooksResource) List(ctx context.Context) ([]Webhook, error) {
	var out struct {
		Data []Webhook `json:"data"`
	}
	return out.Data, r.client.do(ctx, "GET", "/webhooks", nil, &out, "")
}

func (r *WebhooksResource) Get(ctx context.Context, id string) (*Webhook, error) {
	var out Webhook
	return &out, r.client.do(ctx, "GET", fmt.Sprintf("/webhooks/%s", id), nil, &out, "")
}

func (r *WebhooksResource) Create(ctx context.Context, data map[string]any) (*Webhook, error) {
	var out Webhook
	return &out, r.client.do(ctx, "POST", "/webhooks", data, &out, "")
}

func (r *WebhooksResource) Update(ctx context.Context, id string, data map[string]any) (*Webhook, error) {
	var out Webhook
	return &out, r.client.do(ctx, "PATCH", fmt.Sprintf("/webhooks/%s", id), data, &out, "")
}

func (r *WebhooksResource) Delete(ctx context.Context, id string) error {
	return r.client.do(ctx, "DELETE", fmt.Sprintf("/webhooks/%s", id), nil, nil, "")
}

func (r *WebhooksResource) Test(ctx context.Context, id string) (map[string]any, error) {
	var out map[string]any
	return out, r.client.do(ctx, "POST", fmt.Sprintf("/webhooks/%s/test", id), nil, &out, "")
}
