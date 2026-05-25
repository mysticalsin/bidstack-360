// Package bidstack provides the Go SDK for the BidStack 360° CRM API.
package bidstack

import "fmt"

// APIError is returned for any non-2xx HTTP response from the BidStack API.
type APIError struct {
	StatusCode int
	Message    string
	// Errors holds field-level validation errors (HTTP 422 only).
	Errors []FieldError
	// RetryAfter is non-zero for HTTP 429 responses (seconds).
	RetryAfter float64
}

// FieldError describes a single validation failure on a named field.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e *APIError) Error() string {
	return fmt.Sprintf("BidStack API error %d: %s", e.StatusCode, e.Message)
}

// IsNotFound reports whether the error is a 404.
func IsNotFound(err error) bool {
	if e, ok := err.(*APIError); ok {
		return e.StatusCode == 404
	}
	return false
}

// IsAuthError reports whether the error is a 401.
func IsAuthError(err error) bool {
	if e, ok := err.(*APIError); ok {
		return e.StatusCode == 401
	}
	return false
}

// IsRateLimit reports whether the error is a 429.
func IsRateLimit(err error) bool {
	if e, ok := err.(*APIError); ok {
		return e.StatusCode == 429
	}
	return false
}
