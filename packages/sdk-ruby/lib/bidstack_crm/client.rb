require "faraday"
require "faraday/retry"
require "securerandom"
require "json"

require_relative "errors"
require_relative "resources/leads"
require_relative "resources/opportunities"
require_relative "resources/contacts"
require_relative "resources/deals"
require_relative "resources/accounts"
require_relative "resources/activities"
require_relative "resources/custom_fields"
require_relative "resources/custom_objects"
require_relative "resources/webhooks"
require_relative "resources/notifications"

module BidstackCrm
  # BidStackClient is the main entry point for the BidStack 360° Ruby SDK.
  #
  # @example
  #   client = BidstackCrm::Client.new(api_key: "bsk_live_...")
  #   leads  = client.leads.list
  class Client
    DEFAULT_BASE_URL = "https://api.bidstack.io/v1"
    MAX_RETRIES      = 3

    attr_reader :leads, :opportunities, :contacts, :deals, :accounts,
                :activities, :custom_fields, :custom_objects, :webhooks,
                :notifications

    def initialize(api_key:, base_url: DEFAULT_BASE_URL, max_retries: MAX_RETRIES)
      raise ArgumentError, "api_key must not be blank" if api_key.nil? || api_key.empty?

      @api_key  = api_key
      @conn     = build_connection(base_url.chomp("/"), max_retries)

      @leads          = Resources::Leads.new(self)
      @opportunities  = Resources::Opportunities.new(self)
      @contacts       = Resources::Contacts.new(self)
      @deals          = Resources::Deals.new(self)
      @accounts       = Resources::Accounts.new(self)
      @activities     = Resources::Activities.new(self)
      @custom_fields  = Resources::CustomFields.new(self)
      @custom_objects = Resources::CustomObjects.new(self)
      @webhooks       = Resources::Webhooks.new(self)
      @notifications  = Resources::Notifications.new(self)
    end

    # @api private
    def request(method, path, params: nil, body: nil, idempotency_key: nil)
      headers = {}
      # WHY auto-generate idempotency key: POST/PATCH retried after network
      # failure must never create duplicate records. Auto-generation makes
      # the default behaviour safe without callers knowing the protocol.
      if %i[post patch put].include?(method)
        headers["Idempotency-Key"] = idempotency_key || SecureRandom.uuid
      end

      response = @conn.public_send(method, path) do |req|
        req.params = params if params
        req.body   = body.to_json if body
        headers.each { |k, v| req.headers[k] = v }
      end

      parse_response(response)
    end

    private

    def build_connection(base_url, max_retries)
      Faraday.new(url: base_url) do |f|
        f.headers["Authorization"]  = "Bearer #{@api_key}"
        f.headers["User-Agent"]     = "bidstack-ruby/#{BidstackCrm::VERSION}"
        f.headers["Content-Type"]   = "application/json"
        f.headers["Accept"]         = "application/json"

        # Retry middleware — WHY retry_statuses includes 429/5xx: transient
        # server errors are safe to retry for idempotent methods; POST retries
        # are safe because we send Idempotency-Key on every mutating call.
        f.request :retry,
                  max: max_retries,
                  interval: 0.5,
                  backoff_factor: 2,
                  retry_statuses: [429, 500, 502, 503, 504]

        f.adapter Faraday.default_adapter
      end
    end

    def parse_response(response)
      body = response.body
      parsed = body.empty? ? nil : JSON.parse(body)

      case response.status
      when 200..299 then parsed
      when 401 then raise AuthenticationError.new(dig_message(parsed), status_code: 401, body: parsed)
      when 404 then raise NotFoundError.new(dig_message(parsed), status_code: 404, body: parsed)
      when 422
        errors = parsed.is_a?(Hash) ? parsed["errors"] : []
        raise ValidationError.new(dig_message(parsed), errors: errors, status_code: 422, body: parsed)
      when 429
        retry_after = response.headers["Retry-After"]&.to_f
        raise RateLimitError.new(dig_message(parsed), retry_after: retry_after, status_code: 429, body: parsed)
      when 500..599 then raise ServerError.new(dig_message(parsed), status_code: response.status, body: parsed)
      else raise BidStackError.new(dig_message(parsed), status_code: response.status, body: parsed)
      end
    end

    def dig_message(parsed)
      return "Unknown error" unless parsed.is_a?(Hash)
      parsed["message"] || parsed["error"] || "Unknown error"
    end
  end
end
