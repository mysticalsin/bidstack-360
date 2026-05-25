module BidstackCrm
  module Resources
    class Base
      def initialize(client)
        @client = client
      end

      private

      def get(path, params: nil)
        @client.request(:get, path, params: params)
      end

      def post(path, body: nil, idempotency_key: nil)
        @client.request(:post, path, body: body, idempotency_key: idempotency_key)
      end

      def patch(path, body: nil)
        @client.request(:patch, path, body: body)
      end

      def delete(path)
        @client.request(:delete, path)
      end
    end
  end
end
