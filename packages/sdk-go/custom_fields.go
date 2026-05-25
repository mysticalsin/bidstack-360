package bidstack

import (
	"context"
	"fmt"
)

// CustomField represents a custom field definition.
type CustomField struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	EntityType string `json:"entityType"`
	FieldType  string `json:"fieldType"`
	OrgID      string `json:"orgId"`
}

// CustomFieldsResource exposes custom field definition operations.
type CustomFieldsResource struct {
	client *Client
}

func (r *CustomFieldsResource) List(ctx context.Context, entityType string) ([]CustomField, error) {
	var out struct {
		Data []CustomField `json:"data"`
	}
	return out.Data, r.client.do(ctx, "GET", "/custom-fields?entityType="+entityType, nil, &out, "")
}

func (r *CustomFieldsResource) Create(ctx context.Context, data map[string]any) (*CustomField, error) {
	var out CustomField
	return &out, r.client.do(ctx, "POST", "/custom-fields", data, &out, "")
}

func (r *CustomFieldsResource) Update(ctx context.Context, fieldID string, data map[string]any) (*CustomField, error) {
	var out CustomField
	return &out, r.client.do(ctx, "PATCH", fmt.Sprintf("/custom-fields/%s", fieldID), data, &out, "")
}

func (r *CustomFieldsResource) Delete(ctx context.Context, fieldID string) error {
	return r.client.do(ctx, "DELETE", fmt.Sprintf("/custom-fields/%s", fieldID), nil, nil, "")
}
