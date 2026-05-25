require_relative "base"

module BidstackCrm
  module Resources
    class Contacts < Base
      def list(page: 1, per_page: 50, q: nil)
        params = { page: page, perPage: per_page }
        params[:q] = q if q
        get("/contacts", params: params)
      end

      def find(contact_id) = get("/contacts/#{contact_id}")
      def create(data, idempotency_key: nil) = post("/contacts", body: data, idempotency_key: idempotency_key)
      def update(contact_id, data) = patch("/contacts/#{contact_id}", body: data)
      def destroy(contact_id) = delete("/contacts/#{contact_id}")
    end
  end
end
