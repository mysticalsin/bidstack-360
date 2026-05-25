require_relative "base"

module BidstackCrm
  module Resources
    class Leads < Base
      def list(page: 1, per_page: 50, status: nil, assignee_id: nil, q: nil)
        params = { page: page, perPage: per_page }
        params[:status]     = status     if status
        params[:assigneeId] = assignee_id if assignee_id
        params[:q]          = q          if q
        get("/leads", params: params)
      end

      def find(lead_id)
        get("/leads/#{lead_id}")
      end

      def create(data, idempotency_key: nil)
        post("/leads", body: data, idempotency_key: idempotency_key)
      end

      def update(lead_id, data)
        patch("/leads/#{lead_id}", body: data)
      end

      def destroy(lead_id)
        delete("/leads/#{lead_id}")
      end

      def convert(lead_id, data = {})
        post("/leads/#{lead_id}/convert", body: data)
      end
    end
  end
end
