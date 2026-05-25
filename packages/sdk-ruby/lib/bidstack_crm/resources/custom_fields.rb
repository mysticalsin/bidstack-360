require_relative "base"

module BidstackCrm
  module Resources
    class CustomFields < Base
      def list(entity_type) = get("/custom-fields", params: { entityType: entity_type })
      def create(data) = post("/custom-fields", body: data)
      def update(field_id, data) = patch("/custom-fields/#{field_id}", body: data)
      def destroy(field_id) = delete("/custom-fields/#{field_id}")
    end
  end
end
