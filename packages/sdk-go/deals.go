package bidstack

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// Deal represents a CRM deal record.
type Deal struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Amount    int64          `json:"amount"`
	Stage     string         `json:"stage"`
	OrgID     string         `json:"orgId"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
	Custom    map[string]any `json:"custom,omitempty"`
}

// DealList is the paginated list response.
type DealList struct {
	Data []Deal     `json:"data"`
	Meta Pagination `json:"meta"`
}

// DealsResource exposes deal CRUD operations.
type DealsResource struct {
	client *Client
}

func (r *DealsResource) List(ctx context.Context, page, perPage int) (*DealList, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(max1(page)))
	q.Set("perPage", strconv.Itoa(max1(perPage)))
	var out DealList
	return &out, r.client.do(ctx, "GET", "/deals?"+q.Encode(), nil, &out, "")
}

func (r *DealsResource) Get(ctx context.Context, id string) (*Deal, error) {
	var out Deal
	return &out, r.client.do(ctx, "GET", fmt.Sprintf("/deals/%s", id), nil, &out, "")
}

func (r *DealsResource) Create(ctx context.Context, data map[string]any, idempotencyKey string) (*Deal, error) {
	var out Deal
	return &out, r.client.do(ctx, "POST", "/deals", data, &out, idempotencyKey)
}

func (r *DealsResource) Update(ctx context.Context, id string, data map[string]any) (*Deal, error) {
	var out Deal
	return &out, r.client.do(ctx, "PATCH", fmt.Sprintf("/deals/%s", id), data, &out, "")
}

func (r *DealsResource) Delete(ctx context.Context, id string) error {
	return r.client.do(ctx, "DELETE", fmt.Sprintf("/deals/%s", id), nil, nil, "")
}
