require_relative "base"

module BidstackCrm
  module Resources
    class Accounts < Base
      def list(page: 1, per_page: 50)
        get("/accounts", params: { page: page, perPage: per_page })
      end

      def find(account_id) = get("/accounts/#{account_id}")
      def create(data, idempotency_key: nil) = post("/accounts", body: data, idempotency_key: idempotency_key)
      def update(account_id, data) = patch("/accounts/#{account_id}", body: data)
      def destroy(account_id) = delete("/accounts/#{account_id}")
    end
  end
end
