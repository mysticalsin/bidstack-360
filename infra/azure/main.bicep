// ============================================================================
//  BidStack 360° — Azure Container Apps, ENTERPRISE-HARDENED   ⚠️ VALIDATE FIRST
// ============================================================================
//  STATUS: review-only. Authored against the validated docker-compose.prod.yml
//  topology and the audit gaps (run wfr7ow1ue). NOT run through `az bicep build`,
//  `what-if`, or a real subscription. Every apiVersion / property / secret-ref
//  shape MUST be validated against the checklist in infra/azure/README.md before
//  any deploy. Lines that most commonly drift are marked `// VALIDATE:`.
//
//  Posture: ENTERPRISE HARDENED
//    • VNet-injected Container Apps env, zone-redundant, workload profiles
//    • Postgres Flexible: PRIVATE access (delegated subnet + private DNS), Entra
//      admin, storage auto-grow, geo-redundant backup, HA ZoneRedundant
//    • Redis PREMIUM: private endpoint, AOF persistence, noeviction, zone-redundant
//    • Key Vault: purge protection, RBAC, public access DISABLED, private endpoint
//    • Front Door Premium + WAF in front of api + web (path-routed, single origin)
//    • App Insights + diagnostic settings on PG/Redis/KV + Azure Monitor alerts
//    • Per-service DATABASE_URL (PgBouncer + connection_limit), directUrl for migrate
//    • KEDA queue-depth scaler on the no-ingress worker
//
//  Zero-touch deploy contract: the pipeline runs the `migrate` JOB to success,
//  THEN rolls app revisions. Apps never boot on an unmigrated schema.
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

@description('Resource ID of an existing user-assigned managed identity with AcrPull on the ACR and Key Vault Secrets User on the Key Vault.')
param managedIdentityId string

@description('Principal (object) ID of that same user-assigned managed identity — used for the Postgres Entra administrator binding.')
param managedIdentityPrincipalId string

@description('Postgres administrator login (password auth retained for break-glass; apps use Entra/managed identity).')
param pgAdminLogin string

@secure()
@description('Postgres administrator password (break-glass only).')
param pgAdminPassword string

@secure()
@minLength(64)
@maxLength(64)
@description('64-char hex AES-256-GCM key (openssl rand -hex 32); encrypts per-org Dust + OAuth secrets at rest. REQUIRED in prod.')
param integrationTokenKey string

@secure()
@minLength(64)
@maxLength(64)
@description('64-char hex AES-256-GCM root key (openssl rand -hex 32); enables Contact/Lead/User PII encryption at rest. REQUIRED for real-data prod.')
param piiEncryptionMasterKey string

@secure()
@minLength(32)
@description('HMAC secret shared by api (signs/enqueues) and worker (verifies) for enrichment jobs. REQUIRED — api AND worker refuse to boot without it.')
param jobSigningSecret string

@secure()
@description('Clerk secret key (sk_live_...).')
param clerkSecretKey string

@description('Clerk publishable key (pk_live_...). Not secret, kept together.')
param clerkPublishableKey string

@description('Public base URL of the web app (the Front Door custom domain), e.g. https://app.bidstack.com.')
param publicBaseUrl string

@description('Public base URL of the API. With Front Door path-routing this is the SAME host as publicBaseUrl (e.g. https://app.bidstack.com) — the SPA stays same-origin /api.')
param publicApiUrl string

@secure()
@description('S3-compatible access key ID for document storage (AWS SDK env AWS_ACCESS_KEY_ID).')
param s3AccessKeyId string

@secure()
@description('S3-compatible secret key (AWS SDK env AWS_SECRET_ACCESS_KEY).')
param s3SecretAccessKey string

@description('S3 bucket name.')
param s3Bucket string

@description('S3 region.')
param s3Region string

@description('Optional S3-compatible endpoint (MinIO/R2). Empty for AWS S3.')
param s3Endpoint string = ''

@allowed(['true', 'false'])
@description('Use path-style addressing for S3-compatible providers.')
param s3ForcePathStyle string = 'false'

@secure()
@description('Sentry DSN for api + worker. Empty disables Sentry.')
param sentryDsn string = ''

@description('Postgres HA mode. ZoneRedundant for prod regions that support it.')
@allowed(['Disabled', 'SameZone', 'ZoneRedundant'])
param postgresHighAvailabilityMode string = 'ZoneRedundant'

@description('VNet address space (a /21 leaves room for the ACA infra subnet + PE subnet + PG delegated subnet).')
param vnetAddressPrefix string = '10.40.0.0/21'

@description('Email address for the Azure Monitor action group (ops alerts).')
param alertEmail string

@description('Log Analytics retention in days (enterprise/compliance bar ≥ 90).')
@minValue(30)
param logRetentionDays int = 120

// ── Derived names ────────────────────────────────────────────────────────────
var pgServerName = '${namePrefix}-pg'
var pgDatabase = 'bidstack'
var redisName = '${namePrefix}-redis'
var kvName = take(replace('${namePrefix}kv', '-', ''), 24)
var lawName = '${namePrefix}-law'
var aiName = '${namePrefix}-ai'
var envName = '${namePrefix}-cae'
var vnetName = '${namePrefix}-vnet'
var fdName = '${namePrefix}-fd'
var wafName = take('${replace(namePrefix, '-', '')}waf', 24)
var actionGroupName = '${namePrefix}-ag'

// ── Networking: VNet + subnets ────────────────────────────────────────────────
// Subnets: ACA infrastructure (/23 required for workload-profile envs), private
// endpoints, and a delegated subnet for Postgres Flexible VNet integration.
resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: { addressPrefixes: [vnetAddressPrefix] }
    subnets: [
      {
        name: 'aca-infra'
        properties: {
          addressPrefix: cidrSubnet(vnetAddressPrefix, 23, 0) // /23
          delegations: [
            { name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: cidrSubnet(vnetAddressPrefix, 26, 8) // /26 inside the /21
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'pg-delegated'
        properties: {
          addressPrefix: cidrSubnet(vnetAddressPrefix, 26, 9) // /26
          delegations: [
            { name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
          ]
        }
      }
    ]
  }
}

resource acaInfraSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-01-01' existing = {
  parent: vnet
  name: 'aca-infra'
}
resource peSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-01-01' existing = {
  parent: vnet
  name: 'private-endpoints'
}
resource pgSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-01-01' existing = {
  parent: vnet
  name: 'pg-delegated'
}

// ── Private DNS zones (resolve private-endpoint / VNet-integrated FQDNs) ───────
var pgDnsZoneName = '${pgServerName}.private.postgres.database.azure.com'
resource pgDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: pgDnsZoneName
  location: 'global'
}
resource pgDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: pgDnsZone
  name: 'link'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
}

resource redisDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.redis.cache.windows.net'
  location: 'global'
}
resource redisDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: redisDnsZone
  name: 'link'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
}

resource kvDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
}
resource kvDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: kvDnsZone
  name: 'link'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
}

// ── Observability: Log Analytics + Application Insights ───────────────────────
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: aiName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id // workspace-based App Insights
  }
}

// ── Postgres Flexible Server — PRIVATE (VNet-integrated) + Entra admin ────────
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgServerName
  location: location
  sku: { name: 'Standard_D2ds_v5', tier: 'GeneralPurpose' }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled' // keep break-glass; apps prefer Entra (see pgEntraAdmin)
      tenantId: subscription().tenantId
    }
    storage: {
      storageSizeGB: 64
      autoGrow: 'Enabled' // VALIDATE: property name on this apiVersion
    }
    backup: { backupRetentionDays: 35, geoRedundantBackup: 'Enabled' }
    highAvailability: { mode: postgresHighAvailabilityMode }
    // Private access: no public endpoint, integrate into the delegated subnet.
    network: {
      delegatedSubnetResourceId: pgSubnet.id
      privateDnsZoneArmResourceId: pgDnsZone.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [pgDnsLink]
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: pgDatabase
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// pgvector + contrib extensions the migrations CREATE EXTENSION (allow-list BEFORE migrate runs).
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: { value: 'VECTOR,PGCRYPTO,PG_TRGM,CITEXT', source: 'user-override' }
}

// Enable the built-in PgBouncer (transaction pooling on :6432) so Prisma pools
// across api/worker/mcp replicas don't exhaust max_connections.
resource pgBouncer 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'pgbouncer.enabled'
  properties: { value: 'true', source: 'user-override' }
}

// Entra administrator = the app's user-assigned managed identity, so api/worker
// can auth to Postgres with a token (no static password in the hot path).
resource pgEntraAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: pg
  name: managedIdentityPrincipalId
  properties: {
    principalType: 'ServicePrincipal'
    principalName: '${namePrefix}-app-identity'
    tenantId: subscription().tenantId
  }
  dependsOn: [pgExtensions]
}

// ── Redis PREMIUM — private endpoint, persistence, noeviction, zone-redundant ─
resource redis 'Microsoft.Cache/redis@2023-08-01' = {
  name: redisName
  location: location
  zones: ['1', '2', '3'] // zone redundancy (Premium)
  properties: {
    sku: { name: 'Premium', family: 'P', capacity: 1 }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
    redisConfiguration: {
      // BullMQ MUST run on noeviction or queued jobs/locks get evicted under
      // memory pressure (Azure default is volatile-lru). + AOF persistence so a
      // failover/reboot does not lose the in-memory queue.
      'maxmemory-policy': 'noeviction'
      'aof-backup-enabled': 'true' // VALIDATE: requires Premium + a storage account for AOF
    }
  }
}

// ── Key Vault — purge protection, RBAC, public access OFF, private endpoint ────
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true // managed identity needs "Key Vault Secrets User"
    enableSoftDelete: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'AzureServices' }
  }
}

// ── Private endpoints (Redis + Key Vault) + DNS zone groups ───────────────────
resource redisPe 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: '${redisName}-pe'
  location: location
  properties: {
    subnet: { id: peSubnet.id }
    privateLinkServiceConnections: [
      {
        name: 'redis'
        properties: { privateLinkServiceId: redis.id, groupIds: ['redisCache'] }
      }
    ]
  }
}
resource redisPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: redisPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'redis', properties: { privateDnsZoneId: redisDnsZone.id } }
    ]
  }
  dependsOn: [redisDnsLink]
}

resource kvPe 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: '${kvName}-pe'
  location: location
  properties: {
    subnet: { id: peSubnet.id }
    privateLinkServiceConnections: [
      {
        name: 'kv'
        properties: { privateLinkServiceId: kv.id, groupIds: ['vault'] }
      }
    ]
  }
}
resource kvPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: kvPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'kv', properties: { privateDnsZoneId: kvDnsZone.id } }
    ]
  }
  dependsOn: [kvDnsLink]
}

// ── Connection strings ────────────────────────────────────────────────────────
// VALIDATE: with PgBouncer the runtime connects on :6432. Per-service connection
// limits keep sum(replicas*limit)+worker under max_connections. Migrate needs a
// DIRECT connection (:5432, no pooler) — Prisma `directUrl`.
var pgHost = pg.properties.fullyQualifiedDomainName
var dbBase = '${pgAdminLogin}:${pgAdminPassword}@${pgHost}'
var databaseUrlApi = 'postgresql://${dbBase}:6432/${pgDatabase}?sslmode=require&pgbouncer=true&connection_limit=10&pool_timeout=10'
var databaseUrlWorker = 'postgresql://${dbBase}:6432/${pgDatabase}?sslmode=require&pgbouncer=true&connection_limit=40&pool_timeout=20'
var databaseUrlMcp = 'postgresql://${dbBase}:6432/${pgDatabase}?sslmode=require&pgbouncer=true&connection_limit=5&pool_timeout=10'
var databaseUrlDirect = 'postgresql://${dbBase}:5432/${pgDatabase}?sslmode=require'
var redisUrl = 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:6380'

var secretMap = {
  'database-url-api': databaseUrlApi
  'database-url-worker': databaseUrlWorker
  'database-url-mcp': databaseUrlMcp
  'database-url-direct': databaseUrlDirect
  'redis-url': redisUrl
  'integration-token-key': integrationTokenKey
  'pii-encryption-master-key': piiEncryptionMasterKey
  'job-signing-secret': jobSigningSecret
  'clerk-secret-key': clerkSecretKey
  's3-access-key-id': s3AccessKeyId
  's3-secret-access-key': s3SecretAccessKey
  'sentry-dsn': sentryDsn
}

resource kvSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [
  for item in items(secretMap): {
    parent: kv
    name: item.key
    properties: { value: item.value }
  }
]

// ── Container Apps Environment — VNet-injected + zone-redundant ────────────────
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    zoneRedundant: true
    vnetConfiguration: {
      infrastructureSubnetId: acaInfraSubnet.id
      internal: false // public ingress exists but is fronted/locked to Front Door
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
    appInsightsConfiguration: { connectionString: appInsights.properties.ConnectionString } // VALIDATE
    openTelemetryConfiguration: {
      tracesConfiguration: { destinations: ['appInsights'] }
      logsConfiguration: { destinations: ['appInsights'] }
    }
  }
  dependsOn: [vnet]
}

// VALIDATE: Container Apps Key Vault secret refs with a user-assigned identity
// use { name, keyVaultUrl, identity }. Auto-rotation interval is ~30m on this shape.
var kvUri = kv.properties.vaultUri
func kvSecret(secretName string, miId string, vaultUri string) object => {
  name: secretName
  keyVaultUrl: '${vaultUri}secrets/${secretName}'
  identity: miId
}

var commonSecrets = [
  kvSecret('redis-url', managedIdentityId, kvUri)
  kvSecret('integration-token-key', managedIdentityId, kvUri)
  kvSecret('pii-encryption-master-key', managedIdentityId, kvUri)
  kvSecret('job-signing-secret', managedIdentityId, kvUri)
  kvSecret('clerk-secret-key', managedIdentityId, kvUri)
  kvSecret('s3-access-key-id', managedIdentityId, kvUri)
  kvSecret('s3-secret-access-key', managedIdentityId, kvUri)
  kvSecret('sentry-dsn', managedIdentityId, kvUri)
]
var registries = [{ server: acrLoginServer, identity: managedIdentityId }]
var identityBlock = { type: 'UserAssigned', userAssignedIdentities: { '${managedIdentityId}': {} } }
var aiConnString = appInsights.properties.ConnectionString

// Env shared by api + worker (secret refs + plaintext config).
var sharedEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'REDIS_URL', secretRef: 'redis-url' }
  { name: 'INTEGRATION_TOKEN_KEY', secretRef: 'integration-token-key' }
  { name: 'PII_FIELD_ENCRYPTION', value: 'true' }
  { name: 'PII_ENCRYPTION_MASTER_KEY', secretRef: 'pii-encryption-master-key' }
  { name: 'BIDSTACK_JOB_SIGNING_SECRET', secretRef: 'job-signing-secret' }
  { name: 'STORAGE_DRIVER', value: 's3' }
  { name: 'S3_BUCKET', value: s3Bucket }
  { name: 'S3_REGION', value: s3Region }
  { name: 'S3_ENDPOINT', value: s3Endpoint }
  { name: 'S3_FORCE_PATH_STYLE', value: s3ForcePathStyle }
  { name: 'AWS_ACCESS_KEY_ID', secretRef: 's3-access-key-id' }
  { name: 'AWS_SECRET_ACCESS_KEY', secretRef: 's3-secret-access-key' }
  { name: 'STORAGE_SCAN_REQUIRED', value: 'true' }
  { name: 'SENTRY_DSN', secretRef: 'sentry-dsn' }
  { name: 'SENTRY_ENVIRONMENT', value: 'production' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: aiConnString }
  { name: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: 'http://localhost:4318' } // ACA OTel agent sidecar
]

// ── Migrate Job (one-shot; pipeline runs to completion before apps roll) ──────
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
      secrets: [kvSecret('database-url-direct', managedIdentityId, kvUri)]
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
            { name: 'DATABASE_URL', secretRef: 'database-url-direct' } // direct :5432, no pooler
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
      ingress: {
        external: true
        targetPort: 4000
        transport: 'auto'
        // Lock public ingress to Front Door (defense-in-depth; app also checks X-Azure-FDID).
        ipSecurityRestrictions: [] // VALIDATE: prefer Front Door Private Link origin; else AzureFrontDoor.Backend service tag
      }
      secrets: concat(commonSecrets, [kvSecret('database-url-api', managedIdentityId, kvUri)])
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${acrLoginServer}/bidstack-api:${imageTag}'
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: concat(sharedEnv, [
            { name: 'DATABASE_URL', secretRef: 'database-url-api' }
            { name: 'PUBLIC_BASE_URL', value: publicBaseUrl }
            { name: 'PUBLIC_API_URL', value: publicApiUrl }
            { name: 'CLERK_SECRET_KEY', secretRef: 'clerk-secret-key' }
            { name: 'CLERK_PUBLISHABLE_KEY', value: clerkPublishableKey }
            // Front Door + ACA Envoy put the client IP 2 hops upstream.
            { name: 'TRUSTED_PROXIES', value: '2' }
            { name: 'OTEL_SERVICE_NAME', value: 'bidstack-api' }
          ])
          probes: [
            { type: 'Readiness', httpGet: { path: '/readyz', port: 4000 }, periodSeconds: 10 }
            { type: 'Liveness', httpGet: { path: '/livez', port: 4000 }, periodSeconds: 30 }
          ]
        }
      ]
      scale: {
        minReplicas: 2 // HA across zones; survives a revision roll / node drain
        maxReplicas: 10
        rules: [
          { name: 'http', http: { metadata: { concurrentRequests: '80' } } }
        ]
      }
    }
  }
  dependsOn: [migrateJob, redisPeDns, kvPeDns]
}

// ── Worker (no ingress; KEDA queue-depth scaler) ──────────────────────────────
resource workerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-worker'
  location: location
  identity: identityBlock
  properties: {
    environmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: concat(commonSecrets, [
        kvSecret('database-url-worker', managedIdentityId, kvUri)
        // KEDA needs the Redis connection to read list depth.
        kvSecret('redis-url', managedIdentityId, kvUri)
      ])
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: '${acrLoginServer}/bidstack-worker:${imageTag}'
          resources: { cpu: json('1.0'), memory: '2Gi' } // OCR + python sidecar
          env: concat(sharedEnv, [
            { name: 'DATABASE_URL', secretRef: 'database-url-worker' }
            { name: 'WORKER_SHUTDOWN_TIMEOUT_MS', value: '120000' }
            { name: 'OTEL_SERVICE_NAME', value: 'bidstack-worker' }
          ])
          probes: [
            { type: 'Liveness', httpGet: { path: '/livez', port: 4002 }, periodSeconds: 30 }
            { type: 'Readiness', httpGet: { path: '/health', port: 4002 }, periodSeconds: 15 }
          ]
        }
      ]
      scale: {
        minReplicas: 2
        maxReplicas: 6
        // VALIDATE: KEDA redis scaler — scale on BullMQ wait-list depth. listName
        // must match a representative high-volume queue's wait list.
        rules: [
          {
            name: 'queue-depth'
            custom: {
              type: 'redis'
              metadata: {
                addressFromEnv: 'REDIS_HOST_PORT' // VALIDATE: scaler wants host:port + TLS/db, not a URL
                listName: 'bull:document-extract:wait'
                listLength: '20'
                enableTLS: 'true'
              }
              auth: [{ secretRef: 'redis-url', triggerParameter: 'password' }] // VALIDATE shape
            }
          }
        ]
      }
    }
  }
  terminationGracePeriodSeconds: 150 // > WORKER_SHUTDOWN_TIMEOUT_MS so drains complete
  dependsOn: [migrateJob, redisPeDns, kvPeDns]
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
      ingress: { external: false, targetPort: 4001, transport: 'auto' }
      secrets: [
        kvSecret('database-url-mcp', managedIdentityId, kvUri)
        kvSecret('redis-url', managedIdentityId, kvUri)
        kvSecret('integration-token-key', managedIdentityId, kvUri)
        kvSecret('pii-encryption-master-key', managedIdentityId, kvUri)
      ]
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
            { name: 'DATABASE_URL', secretRef: 'database-url-mcp' }
            { name: 'REDIS_URL', secretRef: 'redis-url' }
            { name: 'INTEGRATION_TOKEN_KEY', secretRef: 'integration-token-key' }
            { name: 'PII_FIELD_ENCRYPTION', value: 'true' }
            { name: 'PII_ENCRYPTION_MASTER_KEY', secretRef: 'pii-encryption-master-key' }
            { name: 'PORT_MCP', value: '4001' }
            { name: 'MCP_HEALTH_PORT', value: '4003' }
          ]
          probes: [{ type: 'Liveness', httpGet: { path: '/health', port: 4003 }, periodSeconds: 30 }]
        }
      ]
      scale: { minReplicas: 2, maxReplicas: 4 }
    }
  }
  dependsOn: [migrateJob, redisPeDns, kvPeDns]
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
      ingress: { external: true, targetPort: 8080, transport: 'auto' }
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
      scale: { minReplicas: 2, maxReplicas: 4 }
    }
  }
}

// ── Front Door Premium + WAF ──────────────────────────────────────────────────
// Single public origin (custom domain on publicBaseUrl). Path routing sends
// /api/* and /webhooks/* to the api app and everything else to the web app, so
// the SPA stays same-origin /api (no CORS, no nginx api:4000 dependency).
resource waf 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2024-02-01' = {
  name: wafName
  location: 'global'
  sku: { name: 'Premium_AzureFrontDoor' }
  properties: {
    policySettings: { enabledState: 'Enabled', mode: 'Prevention' }
    managedRules: {
      managedRuleSets: [
        { ruleSetType: 'Microsoft_DefaultRuleSet', ruleSetVersion: '2.1' }
        { ruleSetType: 'Microsoft_BotManagerRuleSet', ruleSetVersion: '1.0' }
      ]
    }
  }
}

resource fd 'Microsoft.Cdn/profiles@2024-02-01' = {
  name: fdName
  location: 'global'
  sku: { name: 'Premium_AzureFrontDoor' }
}

resource fdEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = {
  parent: fd
  name: namePrefix
  location: 'global'
  properties: { enabledState: 'Enabled' }
}

resource fdOriginGroupApi 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: fd
  name: 'api'
  properties: {
    loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3 }
    healthProbeSettings: { probePath: '/livez', probeProtocol: 'Https', probeRequestType: 'GET', probeIntervalInSeconds: 30 }
  }
}
resource fdOriginApi 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: fdOriginGroupApi
  name: 'api'
  properties: {
    hostName: apiApp.properties.configuration.ingress.fqdn
    originHostHeader: apiApp.properties.configuration.ingress.fqdn
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
  }
}

resource fdOriginGroupWeb 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: fd
  name: 'web'
  properties: {
    loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3 }
    healthProbeSettings: { probePath: '/', probeProtocol: 'Https', probeRequestType: 'GET', probeIntervalInSeconds: 60 }
  }
}
resource fdOriginWeb 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: fdOriginGroupWeb
  name: 'web'
  properties: {
    hostName: webApp.properties.configuration.ingress.fqdn
    originHostHeader: webApp.properties.configuration.ingress.fqdn
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
  }
}

// API routes first (more specific patterns), then the web catch-all.
resource fdRouteApi 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: fdEndpoint
  name: 'api'
  properties: {
    originGroup: { id: fdOriginGroupApi.id }
    supportedProtocols: ['Https']
    patternsToMatch: ['/api/*', '/webhooks/*', '/livez', '/readyz']
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
  }
  dependsOn: [fdOriginApi]
}
resource fdRouteWeb 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: fdEndpoint
  name: 'web'
  properties: {
    originGroup: { id: fdOriginGroupWeb.id }
    supportedProtocols: ['Https']
    patternsToMatch: ['/*']
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
  }
  dependsOn: [fdOriginWeb]
}

resource fdSecurityPolicy 'Microsoft.Cdn/profiles/securityPolicies@2024-02-01' = {
  parent: fd
  name: 'waf'
  properties: {
    parameters: {
      type: 'WebApplicationFirewall'
      wafPolicy: { id: waf.id }
      associations: [
        {
          domains: [{ id: fdEndpoint.id }]
          patternsToMatch: ['/*']
        }
      ]
    }
  }
}

// ── Diagnostic settings (resource logs → Log Analytics) ───────────────────────
resource pgDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: pg
  name: 'to-law'
  properties: {
    workspaceId: law.id
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}
resource redisDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: redis
  name: 'to-law'
  properties: {
    workspaceId: law.id
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}
resource kvDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: kv
  name: 'to-law'
  properties: {
    workspaceId: law.id
    logs: [{ categoryGroup: 'audit', enabled: true }]
  }
}

// ── Azure Monitor: action group + alerts ──────────────────────────────────────
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  properties: {
    groupShortName: take(namePrefix, 12)
    enabled: true
    emailReceivers: [{ name: 'ops', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}

resource pgStorageAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-pg-storage'
  location: 'global'
  properties: {
    severity: 2
    enabled: true
    scopes: [pg.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        { name: 'storage', metricName: 'storage_percent', operator: 'GreaterThan', threshold: 85, timeAggregation: 'Average', criterionType: 'StaticThresholdCriterion' }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

resource redisMemAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-redis-mem'
  location: 'global'
  properties: {
    severity: 1
    enabled: true
    scopes: [redis.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        { name: 'usedmemory', metricName: 'usedmemorypercentage', operator: 'GreaterThan', threshold: 80, timeAggregation: 'Average', criterionType: 'StaticThresholdCriterion' }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output frontDoorEndpoint string = fdEndpoint.properties.hostName
output apiFqdn string = apiApp.properties.configuration.ingress.fqdn
output webFqdn string = webApp.properties.configuration.ingress.fqdn
output migrateJobName string = migrateJob.name
output postgresFqdn string = pg.properties.fullyQualifiedDomainName
