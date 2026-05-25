require_relative "base"

module BidstackCrm
  module Resources
    class CustomObjects < Base
      def list_schemas = get("/custom-objects/schemas")
      def list(object_type, page: 1, per_page: 50) = get("/custom-objects/#{object_type}", params: { page: page, perPage: per_page })
      def find(object_type, record_id) = get("/custom-objects/#{object_type}/#{record_id}")
      def create(object_type, data, idempotency_key: nil) = post("/custom-objects/#{object_type}", body: data, idempotency_key: idempotency_key)
      def update(object_type, record_id, data) = patch("/custom-objects/#{object_type}/#{record_id}", body: data)
      def destroy(object_type, record_id) = delete("/custom-objects/#{object_type}/#{record_id}")
    end
  end
end
