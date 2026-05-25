package bidstack

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// Notification represents a user notification.
type Notification struct {
	ID        string `json:"id"`
	Message   string `json:"message"`
	Read      bool   `json:"read"`
	CreatedAt string `json:"createdAt"`
}

// NotificationList is the paginated list response.
type NotificationList struct {
	Data []Notification `json:"data"`
	Meta Pagination     `json:"meta"`
}

// NotificationsResource exposes notification operations.
type NotificationsResource struct {
	client *Client
}

func (r *NotificationsResource) List(ctx context.Context, page, perPage int, unreadOnly bool) (*NotificationList, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(max1(page)))
	q.Set("perPage", strconv.Itoa(max1(perPage)))
	if unreadOnly {
		q.Set("unreadOnly", "true")
	}
	var out NotificationList
	return &out, r.client.do(ctx, "GET", "/notifications?"+q.Encode(), nil, &out, "")
}

func (r *NotificationsResource) MarkRead(ctx context.Context, id string) (*Notification, error) {
	var out Notification
	return &out, r.client.do(ctx, "PATCH", fmt.Sprintf("/notifications/%s", id), map[string]any{"read": true}, &out, "")
}

func (r *NotificationsResource) MarkAllRead(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	return out, r.client.do(ctx, "POST", "/notifications/mark-all-read", nil, &out, "")
}
