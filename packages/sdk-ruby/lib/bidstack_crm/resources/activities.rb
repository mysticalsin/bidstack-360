require_relative "base"

module BidstackCrm
  module Resources
    class Activities < Base
      def list(page: 1, per_page: 50, entity_type: nil, entity_id: nil)
        params = { page: page, perPage: per_page }
        params[:entityType] = entity_type if entity_type
        params[:entityId]   = entity_id   if entity_id
        get("/activities", params: params)
      end

      def find(activity_id) = get("/activities/#{activity_id}")
      def create(data, idempotency_key: nil) = post("/activities", body: data, idempotency_key: idempotency_key)
      def update(activity_id, data) = patch("/activities/#{activity_id}", body: data)
      def destroy(activity_id) = delete("/activities/#{activity_id}")
    end
  end
end
