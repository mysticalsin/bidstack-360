require_relative "bidstack_crm/version"
require_relative "bidstack_crm/errors"
require_relative "bidstack_crm/client"

# BidstackCrm — top-level namespace for the BidStack 360° Ruby SDK.
#
# @example Quick start
#   require "bidstack_crm"
#
#   client = BidstackCrm::Client.new(api_key: ENV["BIDSTACK_API_KEY"])
#   leads  = client.leads.list(per_page: 20, status: "OPEN")
#   leads["data"].each { |l| puts l["name"] }
module BidstackCrm
end
