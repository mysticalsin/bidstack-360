require_relative "base"

module BidstackCrm
  module Resources
    class Deals < Base
      def list(page: 1, per_page: 50)
        get("/deals", params: { page: page, perPage: per_page })
      end

      def find(deal_id) = get("/deals/#{deal_id}")
      def create(data, idempotency_key: nil) = post("/deals", body: data, idempotency_key: idempotency_key)
      def update(deal_id, data) = patch("/deals/#{deal_id}", body: data)
      def destroy(deal_id) = delete("/deals/#{deal_id}")
    end
  end
end
