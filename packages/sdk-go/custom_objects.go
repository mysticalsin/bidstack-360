package bidstack

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// CustomObjectsResource exposes custom object record operations.
type CustomObjectsResource struct {
	client *Client
}

func (r *CustomObjectsResource) ListSchemas(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	return out, r.client.do(ctx, "GET", "/custom-objects/schemas", nil, &out, "")
}

func (r *CustomObjectsResource) List(ctx context.Context, objectType string, page, perPage int) (map[string]any, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(max1(page)))
	q.Set("perPage", strconv.Itoa(max1(perPage)))
	var out map[string]any
	return out, r.client.do(ctx, "GET", fmt.Sprintf("/custom-objects/%s?%s", objectType, q.Encode()), nil, &out, "")
}

func (r *CustomObjectsResource) Get(ctx context.Context, objectType, recordID string) (map[string]any, error) {
	var out map[string]any
	return out, r.client.do(ctx, "GET", fmt.Sprintf("/custom-objects/%s/%s", objectType, recordID), nil, &out, "")
}

func (r *CustomObjectsResource) Create(ctx context.Context, objectType string, data map[string]any, idempotencyKey string) (map[string]any, error) {
	var out map[string]any
	return out, r.client.do(ctx, "POST", fmt.Sprintf("/custom-objects/%s", objectType), data, &out, idempotencyKey)
}

func (r *CustomObjectsResource) Update(ctx context.Context, objectType, recordID string, data map[string]any) (map[string]any, error) {
	var out map[string]any
	return out, r.client.do(ctx, "PATCH", fmt.Sprintf("/custom-objects/%s/%s", objectType, recordID), data, &out, "")
}

func (r *CustomObjectsResource) Delete(ctx context.Context, objectType, recordID string) error {
	return r.client.do(ctx, "DELETE", fmt.Sprintf("/custom-objects/%s/%s", objectType, recordID), nil, nil, "")
}
