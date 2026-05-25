package bidstack

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// Activity represents a CRM activity (call, email, meeting, note).
type Activity struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	EntityType string         `json:"entityType"`
	EntityID   string         `json:"entityId"`
	OrgID      string         `json:"orgId"`
	CreatedAt  string         `json:"createdAt"`
	UpdatedAt  string         `json:"updatedAt"`
	Custom     map[string]any `json:"custom,omitempty"`
}

// ActivityList is the paginated list response.
type ActivityList struct {
	Data []Activity `json:"data"`
	Meta Pagination `json:"meta"`
}

// ActivitiesResource exposes activity CRUD operations.
type ActivitiesResource struct {
	client *Client
}

func (r *ActivitiesResource) List(ctx context.Context, page, perPage int, entityType, entityID string) (*ActivityList, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(max1(page)))
	q.Set("perPage", strconv.Itoa(max1(perPage)))
	if entityType != "" {
		q.Set("entityType", entityType)
	}
	if entityID != "" {
		q.Set("entityId", entityID)
	}
	var out ActivityList
	return &out, r.client.do(ctx, "GET", "/activities?"+q.Encode(), nil, &out, "")
}

func (r *ActivitiesResource) Get(ctx context.Context, id string) (*Activity, error) {
	var out Activity
	return &out, r.client.do(ctx, "GET", fmt.Sprintf("/activities/%s", id), nil, &out, "")
}

func (r *ActivitiesResource) Create(ctx context.Context, data map[string]any, idempotencyKey string) (*Activity, error) {
	var out Activity
	return &out, r.client.do(ctx, "POST", "/activities", data, &out, idempotencyKey)
}

func (r *ActivitiesResource) Update(ctx context.Context, id string, data map[string]any) (*Activity, error) {
	var out Activity
	return &out, r.client.do(ctx, "PATCH", fmt.Sprintf("/activities/%s", id), data, &out, "")
}

func (r *ActivitiesResource) Delete(ctx context.Context, id string) error {
	return r.client.do(ctx, "DELETE", fmt.Sprintf("/activities/%s", id), nil, nil, "")
}
