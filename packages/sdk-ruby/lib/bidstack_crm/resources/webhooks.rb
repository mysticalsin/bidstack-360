require_relative "base"

module BidstackCrm
  module Resources
    class Webhooks < Base
      def list = get("/webhooks")
      def find(webhook_id) = get("/webhooks/#{webhook_id}")
      def create(data) = post("/webhooks", body: data)
      def update(webhook_id, data) = patch("/webhooks/#{webhook_id}", body: data)
      def destroy(webhook_id) = delete("/webhooks/#{webhook_id}")
      def test(webhook_id) = post("/webhooks/#{webhook_id}/test")
    end
  end
end
