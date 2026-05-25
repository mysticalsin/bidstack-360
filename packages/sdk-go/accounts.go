package bidstack

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// Account represents a CRM account record.
type Account struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Domain    string         `json:"domain,omitempty"`
	OrgID     string         `json:"orgId"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
	Custom    map[string]any `json:"custom,omitempty"`
}

// AccountList is the paginated list response.
type AccountList struct {
	Data []Account  `json:"data"`
	Meta Pagination `json:"meta"`
}

// AccountsResource exposes account CRUD operations.
type AccountsResource struct {
	client *Client
}

func (r *AccountsResource) List(ctx context.Context, page, perPage int) (*AccountList, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(max1(page)))
	q.Set("perPage", strconv.Itoa(max1(perPage)))
	var out AccountList
	return &out, r.client.do(ctx, "GET", "/accounts?"+q.Encode(), nil, &out, "")
}

func (r *AccountsResource) Get(ctx context.Context, id string) (*Account, error) {
	var out Account
	return &out, r.client.do(ctx, "GET", fmt.Sprintf("/accounts/%s", id), nil, &out, "")
}

func (r *AccountsResource) Create(ctx context.Context, data map[string]any, idempotencyKey string) (*Account, error) {
	var out Account
	return &out, r.client.do(ctx, "POST", "/accounts", data, &out, idempotencyKey)
}

func (r *AccountsResource) Update(ctx context.Context, id string, data map[string]any) (*Account, error) {
	var out Account
	return &out, r.client.do(ctx, "PATCH", fmt.Sprintf("/accounts/%s", id), data, &out, "")
}

func (r *AccountsResource) Delete(ctx context.Context, id string) error {
	return r.client.do(ctx, "DELETE", fmt.Sprintf("/accounts/%s", id), nil, nil, "")
}
