package bidstack

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// Contact represents a CRM contact record.
type Contact struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Email     string         `json:"email,omitempty"`
	Phone     string         `json:"phone,omitempty"`
	OrgID     string         `json:"orgId"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
	Custom    map[string]any `json:"custom,omitempty"`
}

// ContactList is the paginated list response.
type ContactList struct {
	Data []Contact  `json:"data"`
	Meta Pagination `json:"meta"`
}

// ContactsResource exposes contact CRUD operations.
type ContactsResource struct {
	client *Client
}

func (r *ContactsResource) List(ctx context.Context, page, perPage int, q string) (*ContactList, error) {
	params := url.Values{}
	params.Set("page", strconv.Itoa(max1(page)))
	params.Set("perPage", strconv.Itoa(max1(perPage)))
	if q != "" {
		params.Set("q", q)
	}
	var out ContactList
	return &out, r.client.do(ctx, "GET", "/contacts?"+params.Encode(), nil, &out, "")
}

func (r *ContactsResource) Get(ctx context.Context, id string) (*Contact, error) {
	var out Contact
	return &out, r.client.do(ctx, "GET", fmt.Sprintf("/contacts/%s", id), nil, &out, "")
}

func (r *ContactsResource) Create(ctx context.Context, data map[string]any, idempotencyKey string) (*Contact, error) {
	var out Contact
	return &out, r.client.do(ctx, "POST", "/contacts", data, &out, idempotencyKey)
}

func (r *ContactsResource) Update(ctx context.Context, id string, data map[string]any) (*Contact, error) {
	var out Contact
	return &out, r.client.do(ctx, "PATCH", fmt.Sprintf("/contacts/%s", id), data, &out, "")
}

func (r *ContactsResource) Delete(ctx context.Context, id string) error {
	return r.client.do(ctx, "DELETE", fmt.Sprintf("/contacts/%s", id), nil, nil, "")
}
