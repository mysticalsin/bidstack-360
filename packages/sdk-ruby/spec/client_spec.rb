require "webmock/rspec"
require "bidstack_crm"

BASE = "https://api.bidstack.io/v1"

RSpec.describe BidstackCrm::Client do
  let(:client) { described_class.new(api_key: "bsk_test_abc", max_retries: 0) }

  describe "authentication" do
    it "sends Authorization: Bearer header on every request" do
      stub = stub_request(:get, "#{BASE}/leads")
        .with(headers: { "Authorization" => "Bearer bsk_test_abc" })
        .to_return(status: 200, body: '{"data":[],"meta":{}}', headers: { "Content-Type" => "application/json" })

      client.leads.list
      expect(stub).to have_been_requested
    end
  end

  describe "idempotency" do
    it "auto-generates Idempotency-Key on POST" do
      stub = stub_request(:post, "#{BASE}/leads")
        .with { |req| req.headers.key?("Idempotency-Key") }
        .to_return(status: 201, body: '{"id":"lead_1"}', headers: { "Content-Type" => "application/json" })

      client.leads.create({ name: "ACME" })
      expect(stub).to have_been_requested
    end

    it "passes caller-supplied Idempotency-Key unchanged" do
      stub = stub_request(:post, "#{BASE}/leads")
        .with(headers: { "Idempotency-Key" => "my-key-123" })
        .to_return(status: 201, body: '{"id":"lead_2"}', headers: { "Content-Type" => "application/json" })

      client.leads.create({ name: "Beta" }, idempotency_key: "my-key-123")
      expect(stub).to have_been_requested
    end
  end

  describe "error handling" do
    it "raises AuthenticationError on 401" do
      stub_request(:get, "#{BASE}/leads")
        .to_return(status: 401, body: '{"message":"Unauthorized"}', headers: { "Content-Type" => "application/json" })
      expect { client.leads.list }.to raise_error(BidstackCrm::AuthenticationError)
    end

    it "raises NotFoundError on 404" do
      stub_request(:get, "#{BASE}/leads/missing")
        .to_return(status: 404, body: '{"message":"Not found"}', headers: { "Content-Type" => "application/json" })
      expect { client.leads.find("missing") }.to raise_error(BidstackCrm::NotFoundError)
    end

    it "raises ValidationError with field errors on 422" do
      stub_request(:post, "#{BASE}/leads")
        .to_return(status: 422, body: '{"message":"Validation failed","errors":[{"field":"name","message":"required"}]}',
                   headers: { "Content-Type" => "application/json" })
      expect { client.leads.create({}) }.to raise_error(BidstackCrm::ValidationError) do |e|
        expect(e.errors.first["field"]).to eq("name")
      end
    end

    it "raises RateLimitError on 429" do
      stub_request(:get, "#{BASE}/leads")
        .to_return(status: 429, body: '{"message":"Too many requests"}',
                   headers: { "Content-Type" => "application/json", "Retry-After" => "60" })
      expect { client.leads.list }.to raise_error(BidstackCrm::RateLimitError) do |e|
        expect(e.retry_after).to eq(60.0)
      end
    end

    it "raises ServerError on 500" do
      stub_request(:get, "#{BASE}/leads")
        .to_return(status: 500, body: '{"message":"Internal error"}', headers: { "Content-Type" => "application/json" })
      expect { client.leads.list }.to raise_error(BidstackCrm::ServerError)
    end
  end

  describe "opportunities" do
    it "moves a stage via PATCH" do
      stub = stub_request(:patch, "#{BASE}/opportunities/opp_1")
        .with(body: { stage: "NEGOTIATION" })
        .to_return(status: 200, body: '{"id":"opp_1","stage":"NEGOTIATION"}', headers: { "Content-Type" => "application/json" })

      result = client.opportunities.move_stage("opp_1", "NEGOTIATION")
      expect(result["stage"]).to eq("NEGOTIATION")
      expect(stub).to have_been_requested
    end
  end
end
