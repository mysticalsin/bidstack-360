package bidstack

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// Lead represents a CRM lead record.
type Lead struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Email      string         `json:"email,omitempty"`
	Status     string         `json:"status"`
	AssigneeID string         `json:"assigneeId,omitempty"`
	Source     string         `json:"source,omitempty"`
	OrgID      string         `json:"orgId"`
	CreatedAt  string         `json:"createdAt"`
	UpdatedAt  string         `json:"updatedAt"`
	Custom     map[string]any `json:"custom,omitempty"`
}

// LeadList is the paginated response from the list endpoint.
type LeadList struct {
	Data []Lead     `json:"data"`
	Meta Pagination `json:"meta"`
}

// LeadListParams controls filtering and pagination for list.
type LeadListParams struct {
	Page       int
	PerPage    int
	Status     string
	AssigneeID string
	Q          string
}

// LeadsResource exposes lead CRUD operations.
type LeadsResource struct {
	client *Client
}

func (r *LeadsResource) List(ctx context.Context, p LeadListParams) (*LeadList, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(max1(p.Page)))
	q.Set("perPage", strconv.Itoa(max1(p.PerPage)))
	if p.Status != "" {
		q.Set("status", p.Status)
	}
	if p.AssigneeID != "" {
		q.Set("assigneeId", p.AssigneeID)
	}
	if p.Q != "" {
		q.Set("q", p.Q)
	}
	var out LeadList
	return &out, r.client.do(ctx, "GET", "/leads?"+q.Encode(), nil, &out, "")
}

func (r *LeadsResource) Get(ctx context.Context, leadID string) (*Lead, error) {
	var out Lead
	return &out, r.client.do(ctx, "GET", fmt.Sprintf("/leads/%s", leadID), nil, &out, "")
}

func (r *LeadsResource) Create(ctx context.Context, data map[string]any, idempotencyKey string) (*Lead, error) {
	var out Lead
	return &out, r.client.do(ctx, "POST", "/leads", data, &out, idempotencyKey)
}

func (r *LeadsResource) Update(ctx context.Context, leadID string, data map[string]any) (*Lead, error) {
	var out Lead
	return &out, r.client.do(ctx, "PATCH", fmt.Sprintf("/leads/%s", leadID), data, &out, "")
}

func (r *LeadsResource) Delete(ctx context.Context, leadID string) error {
	return r.client.do(ctx, "DELETE", fmt.Sprintf("/leads/%s", leadID), nil, nil, "")
}

func (r *LeadsResource) Convert(ctx context.Context, leadID string, data map[string]any) (map[string]any, error) {
	var out map[string]any
	return out, r.client.do(ctx, "POST", fmt.Sprintf("/leads/%s/convert", leadID), data, &out, "")
}

func max1(n int) int {
	if n < 1 {
		return 1
	}
	return n
}
