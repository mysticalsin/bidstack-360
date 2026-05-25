module BidstackCrm
  # Base error for all SDK-raised exceptions.
  class BidStackError < StandardError
    attr_reader :status_code, :body

    def initialize(message, status_code: nil, body: nil)
      super(message)
      @status_code = status_code
      @body = body
    end
  end

  # HTTP 401
  class AuthenticationError < BidStackError; end

  # HTTP 404
  class NotFoundError < BidStackError; end

  # HTTP 429
  class RateLimitError < BidStackError
    attr_reader :retry_after

    def initialize(message, retry_after: nil, **kwargs)
      super(message, **kwargs)
      @retry_after = retry_after
    end
  end

  # HTTP 422
  class ValidationError < BidStackError
    attr_reader :errors

    def initialize(message, errors: [], **kwargs)
      super(message, **kwargs)
      @errors = errors
    end
  end

  # HTTP 5xx
  class ServerError < BidStackError; end
end
