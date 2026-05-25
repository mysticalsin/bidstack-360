require_relative "lib/bidstack_crm/version"

Gem::Specification.new do |spec|
  spec.name          = "bidstack_crm"
  spec.version       = BidstackCrm::VERSION
  spec.authors       = ["BidStack Engineering"]
  spec.email         = ["sdk@bidstack.io"]
  spec.summary       = "Official Ruby SDK for the BidStack 360° CRM API"
  spec.description   = "Typed Ruby client with bearer-token auth, idempotency-key support, and automatic exponential-backoff retries."
  spec.homepage      = "https://github.com/bidstack/bidstack-ruby"
  spec.license       = "MIT"

  spec.required_ruby_version = ">= 3.1.0"

  spec.metadata["homepage_uri"]    = spec.homepage
  spec.metadata["source_code_uri"] = "https://github.com/bidstack/bidstack-ruby"
  spec.metadata["changelog_uri"]   = "https://github.com/bidstack/bidstack-ruby/blob/main/CHANGELOG.md"
  spec.metadata["rubygems_mfa_required"] = "true"

  spec.files = Dir[
    "lib/**/*.rb",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ]

  spec.require_paths = ["lib"]

  spec.add_dependency "faraday",          ">= 2.7"
  spec.add_dependency "faraday-retry",    ">= 2.2"

  spec.add_development_dependency "rspec",           "~> 3.13"
  spec.add_development_dependency "webmock",         "~> 3.23"
  spec.add_development_dependency "rake",            "~> 13.0"
end
