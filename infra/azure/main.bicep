// ============================================================================
//  BidStack 360° — Azure Container Apps infrastructure   ⚠️ UNVALIDATED DRAFT ⚠️
// ============================================================================
//  STATUS: review-only. This has NOT been run through `az bicep build`, `az
//  deployment ... what-if`, or a real subscription. API versions, property
//  names, and secret wiring MUST be validated before any deploy. See
//  infra/azure/README.md for the validation checklist.
//
//  Topology (mirrors docker-compose.prod.yml, which IS validated):
//    Log Analytics ─┐
//    Key Vault ─────┤ secrets (DATABASE_URL, REDIS_URL, INTEGRATION_TOKEN_KEY,
//                   │          CLERK_*, S3_*) referenced by every app + job
//    Postgres Flexible Server (pgvector via azure.extensions=VECTOR)
//    Azure Cache for Redis
//    Container Apps Environment
//      ├─ Job  : migrate   (one-shot; `prisma migrate deploy`; runs BEFORE apps)
//      ├─ App  : api        (external ingress :4000)
//      ├─ App  : web        (external ingress :80)
//      ├─ App  : worker     (no ingress)
//      └─ App  : mcp-server (internal ingress :4003)
//
//  Zero-touch deploy contract: the pipeline runs the `migrate` JOB to a
//  successful completion, THEN updates the app revisions. Apps never boot on an
//  unmigrated schema. See deploy.workflow.yml.draft.
// ============================================================================

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short prefix for resource names, e.g. "bidstack-prod".')
@minLength(3)
@maxLength(20)
param namePrefix string

@description('Container image tag to deploy (e.g. git SHA). Same tag for all images.')
param imageTag string

@description('ACR login server, e.g. bidstackprod.azurecr.io. Images are <acr>/bidstack-<svc>:<tag>.')
param acrLoginServer string

@description('Resource ID of an existing user-assigned managed identity with AcrPull on the ACR and get/list on the Key Vault.')
param managedIdentityId string

@description('Postgres administrator login.')
param pgAdminLogin string

@secure()
@description('Postgres administrator password.')
param pgAdminPassword string

@secure()
@description('AES-256-GCM key (base64, 32 bytes) that encrypts per-org Dust + OAuth secrets at rest. REQUIRED in prod.')
param integrationTokenKey string

@secure()
@description('Clerk secret key (sk_live_...).')
param clerkSecretKey string

@description('Clerk publishable key (pk_live_...). Not secret, but kept together.')
param clerkPublishableKey string

@description('Public base URL of the web app, e.g. https://app.bidstack.com.')
param publicBaseUrl string

@description('Public base URL of the API, e.g. https://api.bidstack.com.')
param publicApiUrl string

@secure()
@description('S3/Blob storage credentials JSON or connection — supply per your storage driver.')
param storageSecret string

@description('S3 bucket name for document storage.')
param s3Bucket string

@description('S3 region.')
param s3Region string

// ── Derived names ───────────────────────────────────────────────────────────
var pgServerName = '${namePrefix}-pg'
var pgDatabase = 'bidstack'
var redisName = '${namePrefix}-redis'
var kvName = take(replace('${namePrefix}kv', '-', ''), 24) // KV names: ≤24 chars, alphanumeric
var lawName = '${namePrefix}-law'
var envName = '${namePrefix}-cae'

// ── Log Analytics (Container Apps env requires a workspace) ───────────────────
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── Postgres Flexible Server (+ pgvector) ─────────────────────────────────────
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgServerName
  location: location
  sku: { name: 'Standard_D2ds_v5', tier: 'GeneralPurpose' }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: { storageSizeGB: 64 }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' } // flip to ZoneRedundant for prod HA
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: pgDatabase
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// pgvector + the contrib extensions the migrations CREATE EXTENSION (citext,
// pg_trgm, pgcrypto, vector). On Flexible Server these must be allow-listed
// here BEFORE `CREATE EXTENSION` runs, or the migrate job fails.
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: { value: 'VECTOR,PGCRYPTO,PG_TRGM,CITEXT', source: 'user-override' }
}

// Allow other Azure services (Container Apps) to reach the DB. Tighten to the
// Container Apps Environment's outbound IPs / VNet for production.
resource pgFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAllAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// ── Redis ─────────────────────────────────────────────────────────────────────
resource redis 'Microsoft.Cache/redis@2023-08-01' = {
  name: redisName
  location: location
  properties: {
    sku: { name: 'Standard', family: 'C', capacity: 1 }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// ── Connection strings assembled from the provisioned resources ───────────────
var databaseUrl = 'postgresql://${pgAdminLogin}:${pgAdminPassword}@${pg.properties.fullyQualifiedDomainName}:5432/${pgDatabase}?sslmode=require'
var redisUrl = 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:6380'

// ── Key Vault (holds every secret; apps read via managed identity) ────────────
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true // grant the managed identity "Key Vault Secrets User"
    enableSoftDelete: true
  }
}

var secretMap = {
  'database-url': databaseUrl
  'redis-url': redisUrl
  'integration-token-key': integrationTokenKey
  'clerk-secret-key': clerkSecretKey
  'storage-secret': storageSecret
}

resource kvSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [
  for item in items(secretMap): {
    parent: kv
    name: item.key
    properties: { value: item.value }
  }
]

// ── Container Apps Environment ────────────────────────────────────────────────
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

// Common secret + registry wiring reused by every app/job. Each Key Vault ref
// is resolved by the user-assigned managed identity.
var kvUri = kv.properties.vaultUri
var commonSecrets = [
  { name: 'database-url', keyVaultUrl: '${kvUri}secrets/database-url', identity: managedIdentityId }
  { name: 'redis-url', keyVaultUrl: '${kvUri}secrets/redis-url', identity: managedIdentityId }
  { name: 'integration-token-key', keyVaultUrl: '${kvUri}secrets/integration-token-key', identity: managedIdentityId }
  { name: 'clerk-secret-key', keyVaultUrl: '${kvUri}secrets/clerk-secret-key', identity: managedIdentityId }
  { name: 'storage-secret', keyVaultUrl: '${kvUri}secrets/storage-secret', identity: managedIdentityId }
]
var registries = [{ server: acrLoginServer, identity: managedIdentityId }]
var identityBlock = { type: 'UserAssigned', userAssignedIdentities: { '${managedIdentityId}': {} } }

// Env vars shared by api + worker (secret refs + plaintext config).
var sharedEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'REDIS_URL', secretRef: 'redis-url' }
  { name: 'INTEGRATION_TOKEN_KEY', secretRef: 'integration-token-key' }
  { name: 'STORAGE_DRIVER', value: 's3' }
  { name: 'S3_BUCKET', value: s3Bucket }
  { name: 'S3_REGION', value: s3Region }
  { name: 'STORAGE_SCAN_REQUIRED', value: 'true' }
  { name: 'STORAGE_SECRET', secretRef: 'storage-secret' }
]

// ── Migrate Job (one-shot; the pipeline runs this to completion before apps) ──
resource migrateJob 'Microsoft.App/jobs@2024-03-01' = {
  name: '${namePrefix}-migrate'
  location: location
  identity: identityBlock
  properties: {
    environmentId: env.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 1
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      secrets: commonSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: '${acrLoginServer}/bidstack-migrate:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
          ]
        }
      ]
    }
  }
}

// ── API ───────────────────────────────────────────────────────────────────────
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-api'
  location: location
  identity: identityBlock
  properties: {
    environmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 4000, transport: 'auto' }
      secrets: commonSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${acrLoginServer}/bidstack-api:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(sharedEnv, [
            { name: 'PUBLIC_BASE_URL', value: publicBaseUrl }
            { name: 'PUBLIC_API_URL', value: publicApiUrl }
            { name: 'CLERK_SECRET_KEY', secretRef: 'clerk-secret-key' }
            { name: 'CLERK_PUBLISHABLE_KEY', value: clerkPublishableKey }
          ])
          probes: [
            { type: 'Readiness', httpGet: { path: '/readyz', port: 4000 }, periodSeconds: 10 }
            { type: 'Liveness', httpGet: { path: '/healthz', port: 4000 }, periodSeconds: 30 }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 5 }
    }
  }
  dependsOn: [migrateJob] // ordering hint only; the PIPELINE enforces migrate-before-apps
}

// ── Worker (no ingress) ─────────────────────────────────────────────────────
resource workerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-worker'
  location: location
  identity: identityBlock
  properties: {
    environmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: commonSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: '${acrLoginServer}/bidstack-worker:${imageTag}'
          resources: { cpu: json('1.0'), memory: '2Gi' } // OCR + python sidecar
          env: sharedEnv
          probes: [{ type: 'Liveness', httpGet: { path: '/health', port: 4002 }, periodSeconds: 30 }]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
  dependsOn: [migrateJob]
}

// ── MCP server (internal ingress) ─────────────────────────────────────────────
resource mcpApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-mcp'
  location: location
  identity: identityBlock
  properties: {
    environmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: false, targetPort: 4003, transport: 'auto' }
      secrets: commonSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'mcp-server'
          image: '${acrLoginServer}/bidstack-mcp-server:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'REDIS_URL', secretRef: 'redis-url' }
          ]
          probes: [{ type: 'Liveness', httpGet: { path: '/health', port: 4003 }, periodSeconds: 30 }]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 2 }
    }
  }
  dependsOn: [migrateJob]
}

// ── Web (static nginx) ────────────────────────────────────────────────────────
resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-web'
  location: location
  identity: identityBlock
  properties: {
    environmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 80, transport: 'auto' }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'web'
          image: '${acrLoginServer}/bidstack-web:${imageTag}'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

output apiFqdn string = apiApp.properties.configuration.ingress.fqdn
output webFqdn string = webApp.properties.configuration.ingress.fqdn
output migrateJobName string = migrateJob.name
output postgresFqdn string = pg.properties.fullyQualifiedDomainName
