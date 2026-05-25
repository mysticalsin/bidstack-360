require_relative "base"

module BidstackCrm
  module Resources
    class Notifications < Base
      def list(page: 1, per_page: 50, unread_only: false)
        params = { page: page, perPage: per_page }
        params[:unreadOnly] = true if unread_only
        get("/notifications", params: params)
      end

      def mark_read(notification_id) = patch("/notifications/#{notification_id}", body: { read: true })
      def mark_all_read = post("/notifications/mark-all-read")
    end
  end
end
