-- Add a dedicated IntegrationConfig type for HubSpot OAuth migration
-- credentials. Previous route code stored HubSpot under type='salesforce'
-- because the enum did not have a HubSpot value yet.
ALTER TYPE "integration_type" ADD VALUE IF NOT EXISTS 'hubspot';
