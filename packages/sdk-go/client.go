// Package bidstack provides the official Go SDK for BidStack 360° CRM.
//
// Usage:
//
//	client := bidstack.New("bsk_live_YOUR_KEY")
//	leads, err := client.Leads.List(ctx, bidstack.LeadListParams{PerPage: 20})
package bidstack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"time"
)

const (
	defaultBaseURL = "https://api.bidstack.io/v1"
	sdkVersion     = "0.1.0"
	defaultTimeout = 30 * time.Second
	maxRetries     = 3
)

// Client is the BidStack API client. Create one with New().
type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
	retries int

	// Resource accessors
	Leads         *LeadsResource
	Opportunities *OpportunitiesResource
	Contacts      *ContactsResource
	Deals         *DealsResource
	Accounts      *AccountsResource
	Activities    *ActivitiesResource
	CustomFields  *CustomFieldsResource
	CustomObjects *CustomObjectsResource
	Webhooks      *WebhooksResource
	Notifications *NotificationsResource
}

// Option configures a Client.
type Option func(*Client)

// WithBaseURL overrides the default API base URL (useful for on-prem / staging).
func WithBaseURL(u string) Option { return func(c *Client) { c.baseURL = u } }

// WithHTTPClient allows injecting a custom *http.Client (e.g. with a proxy).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithMaxRetries sets the number of automatic retries on 429/5xx.
func WithMaxRetries(n int) Option { return func(c *Client) { c.retries = n } }

// New creates a BidStack API client authenticated with apiKey.
func New(apiKey string, opts ...Option) *Client {
	c := &Client{
		apiKey:  apiKey,
		baseURL: defaultBaseURL,
		http:    &http.Client{Timeout: defaultTimeout},
		retries: maxRetries,
	}
	for _, o := range opts {
		o(c)
	}
	c.Leads = &LeadsResource{c}
	c.Opportunities = &OpportunitiesResource{c}
	c.Contacts = &ContactsResource{c}
	c.Deals = &DealsResource{c}
	c.Accounts = &AccountsResource{c}
	c.Activities = &ActivitiesResource{c}
	c.CustomFields = &CustomFieldsResource{c}
	c.CustomObjects = &CustomObjectsResource{c}
	c.Webhooks = &WebhooksResource{c}
	c.Notifications = &NotificationsResource{c}
	return c
}

// do performs an HTTP request with automatic retry + exponential backoff.
//
// WHY idempotencyKey on POST/PATCH: retries after network failure must never
// create duplicate records. Callers that don't supply a key get a uuid generated
// automatically so safe-retry behaviour is the default.
func (c *Client) do(ctx context.Context, method, path string, body any, out any, idempotencyKey string) error {
	url := c.baseURL + path

	var attempt int
	for {
		var reqBody io.Reader
		if body != nil {
			b, err := json.Marshal(body)
			if err != nil {
				return fmt.Errorf("bidstack: marshal body: %w", err)
			}
			reqBody = bytes.NewReader(b)
		}

		req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
		if err != nil {
			return fmt.Errorf("bidstack: build request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("User-Agent", "bidstack-go/"+sdkVersion)
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if method == http.MethodPost || method == http.MethodPatch || method == http.MethodPut {
			if idempotencyKey == "" {
				idempotencyKey = newUUID()
			}
			req.Header.Set("Idempotency-Key", idempotencyKey)
		}

		resp, err := c.http.Do(req)
		if err != nil {
			if attempt < c.retries {
				attempt++
				sleep(attempt, 0)
				continue
			}
			return fmt.Errorf("bidstack: request failed: %w", err)
		}
		defer resp.Body.Close() //nolint:errcheck

		respBody, _ := io.ReadAll(resp.Body)

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			if out != nil && len(respBody) > 0 {
				if err := json.Unmarshal(respBody, out); err != nil {
					return fmt.Errorf("bidstack: decode response: %w", err)
				}
			}
			return nil
		}

		// Parse error envelope
		var envelope struct {
			Message string       `json:"message"`
			Error   string       `json:"error"`
			Errors  []FieldError `json:"errors"`
		}
		_ = json.Unmarshal(respBody, &envelope)
		msg := envelope.Message
		if msg == "" {
			msg = envelope.Error
		}
		if msg == "" {
			msg = string(respBody)
		}

		retryStatuses := map[int]bool{429: true, 500: true, 502: true, 503: true, 504: true}
		if retryStatuses[resp.StatusCode] && attempt < c.retries {
			var retryAfter float64
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				retryAfter, _ = strconv.ParseFloat(ra, 64)
			}
			attempt++
			sleep(attempt, retryAfter)
			continue
		}

		apiErr := &APIError{StatusCode: resp.StatusCode, Message: msg, Errors: envelope.Errors}
		if resp.StatusCode == 429 {
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				apiErr.RetryAfter, _ = strconv.ParseFloat(ra, 64)
			}
		}
		return apiErr
	}
}

// sleep implements exponential backoff with full jitter, or a server-dictated delay.
func sleep(attempt int, overrideSeconds float64) {
	if overrideSeconds > 0 {
		time.Sleep(time.Duration(overrideSeconds) * time.Second)
		return
	}
	// Full jitter: sleep in [0, base * 2^attempt]
	base := 0.5 * float64(int(1)<<attempt)
	if base > 60 {
		base = 60
	}
	jitter := rand.Float64() * base //nolint:gosec — jitter, not crypto
	time.Sleep(time.Duration(jitter * float64(time.Second)))
}

// Pagination holds paging metadata returned by list endpoints.
type Pagination struct {
	Total   int `json:"total"`
	Page    int `json:"page"`
	PerPage int `json:"perPage"`
}
