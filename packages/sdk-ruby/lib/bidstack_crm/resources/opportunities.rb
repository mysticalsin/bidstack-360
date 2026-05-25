require_relative "base"

module BidstackCrm
  module Resources
    class Opportunities < Base
      def list(page: 1, per_page: 50, stage: nil)
        params = { page: page, perPage: per_page }
        params[:stage] = stage if stage
        get("/opportunities", params: params)
      end

      def find(opportunity_id)
        get("/opportunities/#{opportunity_id}")
      end

      def create(data, idempotency_key: nil)
        post("/opportunities", body: data, idempotency_key: idempotency_key)
      end

      def update(opportunity_id, data)
        patch("/opportunities/#{opportunity_id}", body: data)
      end

      def destroy(opportunity_id)
        delete("/opportunities/#{opportunity_id}")
      end

      def move_stage(opportunity_id, stage)
        patch("/opportunities/#{opportunity_id}", body: { stage: stage })
      end
    end
  end
end
