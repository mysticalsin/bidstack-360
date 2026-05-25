package bidstack

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// Opportunity represents a CRM opportunity record.
type Opportunity struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Stage     string         `json:"stage"`
	Amount    int64          `json:"amount"` // stored in micros
	OrgID     string         `json:"orgId"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
	Custom    map[string]any `json:"custom,omitempty"`
}

// OpportunityList is the paginated list response.
type OpportunityList struct {
	Data []Opportunity `json:"data"`
	Meta Pagination    `json:"meta"`
}

// OpportunitiesResource exposes opportunity CRUD operations.
type OpportunitiesResource struct {
	client *Client
}

func (r *OpportunitiesResource) List(ctx context.Context, page, perPage int, stage string) (*OpportunityList, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(max1(page)))
	q.Set("perPage", strconv.Itoa(max1(perPage)))
	if stage != "" {
		q.Set("stage", stage)
	}
	var out OpportunityList
	return &out, r.client.do(ctx, "GET", "/opportunities?"+q.Encode(), nil, &out, "")
}

func (r *OpportunitiesResource) Get(ctx context.Context, id string) (*Opportunity, error) {
	var out Opportunity
	return &out, r.client.do(ctx, "GET", fmt.Sprintf("/opportunities/%s", id), nil, &out, "")
}

func (r *OpportunitiesResource) Create(ctx context.Context, data map[string]any, idempotencyKey string) (*Opportunity, error) {
	var out Opportunity
	return &out, r.client.do(ctx, "POST", "/opportunities", data, &out, idempotencyKey)
}

func (r *OpportunitiesResource) Update(ctx context.Context, id string, data map[string]any) (*Opportunity, error) {
	var out Opportunity
	return &out, r.client.do(ctx, "PATCH", fmt.Sprintf("/opportunities/%s", id), data, &out, "")
}

func (r *OpportunitiesResource) Delete(ctx context.Context, id string) error {
	return r.client.do(ctx, "DELETE", fmt.Sprintf("/opportunities/%s", id), nil, nil, "")
}

func (r *OpportunitiesResource) MoveStage(ctx context.Context, id, stage string) (*Opportunity, error) {
	return r.Update(ctx, id, map[string]any{"stage": stage})
}
