// =============================================================================
// HD IT Pulse — Azure infrastructure (release 1)
//
// Static Web App (front end), two Function Apps (api: user-facing; sync: timers and
// integrations), Azure SQL (Entra-only), Key Vault (RBAC), storage and monitoring.
//
// Deployed by GitHub Actions into an EXISTING resource group as the deploy identity
// id-hdit-pulse-deploy-<env>-aue (Contributor on the resource group). This template
// contains NO role assignments: the deploy identity can't grant roles. setup/pulse-setup.sh
// creates the Function identities, the Key Vault and its secret-level access beforehand.
//
// The backend is only deployed once sqlAdminGroupId is set (printed by
// `pulse-setup.sh release1-entra`). Until then only the Static Web App is managed, as in v0.3.
//
// Naming follows HD IT's CAF convention: <type>-hdit-<app>-<env>-<region>.
// =============================================================================

targetScope = 'resourceGroup'

@description('Short app code (<= 8 chars).')
@maxLength(8)
param app string = 'pulse'

@description('Environment: dev, test or prod.')
@allowed([ 'dev', 'test', 'prod' ])
param env string = 'test'

@description('Region for everything except the Static Web App.')
param location string = 'australiaeast'

@description('Static Web Apps are not offered in Australia; East Asia is the nearest. Only static files are served from there, never data.')
param swaLocation string = 'eastasia'

@description('Static Web App plan. Free in test; Standard in production (custom domain, SLA).')
@allowed([ 'Free', 'Standard' ])
param swaSku string = 'Free'

@description('Entra tenant that issues Pulse tokens.')
param entraTenantId string = ''

@description('Client id of the HD IT Pulse app registration (the token audience).')
param entraClientId string = ''

@description('Object id of the "Pulse - SQL Admins" Entra group (SQL server administrator). Empty = backend not deployed yet.')
param sqlAdminGroupId string = ''

@description('Display name of that group.')
param sqlAdminGroupName string = 'Pulse - SQL Admins (Test)'

@description('Azure SQL database SKU: Basic in test, S0 in production (D6).')
@allowed([ 'Basic', 'S0', 'S1' ])
param sqlSku string = 'Basic'

@description('Days to keep logs and audit events in Log Analytics. 365 in production (D8).')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

@description('Key Vault purge protection (cannot be turned off once on). On in production.')
param kvPurgeProtection bool = false

@description('Extra browser origins allowed to call the API (e.g. a custom domain).')
param extraOrigins array = []

@description('Tags applied to every resource.')
param tags object = {
  app: app
  env: env
  owner: 'HDIT'
  workload: 'hdit-pulse'
  managedBy: 'bicep'
}

var backend = !empty(sqlAdminGroupId)
var regionCode = 'aue'
var base = 'hdit-${app}-${env}'
var names = {
  swa: 'stapp-${base}-${regionCode}'
  log: 'log-${base}-${regionCode}'
  appi: 'appi-${base}-${regionCode}'
  storage: toLower('sthdit${app}${env}${regionCode}')
  kv: 'kv-${base}'
  sql: 'sql-${base}-${regionCode}'
  sqldb: 'sqldb-${base}-${regionCode}'
  apiPlan: 'asp-hdit-${app}-api-${env}-${regionCode}'
  syncPlan: 'asp-hdit-${app}-sync-${env}-${regionCode}'
  api: 'func-hdit-${app}-api-${env}-${regionCode}'
  sync: 'func-hdit-${app}-sync-${env}-${regionCode}'
  apiIdentity: 'id-hdit-${app}-api-${env}-${regionCode}'     // pre-created by pulse-setup.sh release1
  syncIdentity: 'id-hdit-${app}-sync-${env}-${regionCode}'   // pre-created by pulse-setup.sh release1
}
var apiContainer = 'deploy-api'
var syncContainer = 'deploy-sync'

// ---------------------------------------------------------------------------
// Front end
// ---------------------------------------------------------------------------
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: names.swa
  location: swaLocation
  tags: tags
  sku: { name: swaSku, tier: swaSku }
  properties: {
    stagingEnvironmentPolicy: 'Disabled'
    allowConfigFileUpdates: true
  }
}

var pulseOrigin = 'https://${swa.properties.defaultHostname}'

// ---------------------------------------------------------------------------
// Identities the Function Apps run as (created and granted access beforehand)
// ---------------------------------------------------------------------------
resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = if (backend) {
  name: names.apiIdentity
}

resource syncIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = if (backend) {
  name: names.syncIdentity
}

// ---------------------------------------------------------------------------
// Monitoring: app telemetry, sign-in/audit trail copies and SQL audit events
// ---------------------------------------------------------------------------
resource log 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (backend) {
  name: names.log
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
    workspaceCapping: { dailyQuotaGb: 1 }
  }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = if (backend) {
  name: names.appi
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: log.id
    IngestionMode: 'LogAnalytics'
    RetentionInDays: logRetentionDays
  }
}

// ---------------------------------------------------------------------------
// Storage: Functions host and deployment packages. Entra ID only (no shared keys).
// ---------------------------------------------------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (backend) {
  name: names.storage
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = if (backend) {
  parent: storage
  name: 'default'
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for c in [ apiContainer, syncContainer ]: if (backend) {
  parent: blobService
  name: c
  properties: { publicAccess: 'None' }
}]

// ---------------------------------------------------------------------------
// Key Vault (RBAC). Created by pulse-setup.sh first so secret-level access can be
// granted; declared here so its settings stay as intended. Secrets are never set here.
// ---------------------------------------------------------------------------
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = if (backend) {
  name: names.kv
  location: location
  tags: tags
  properties: union({
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
  }, kvPurgeProtection ? { enablePurgeProtection: true } : {})
}

resource kvDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (backend) {
  name: 'to-log-analytics'
  scope: kv
  properties: {
    workspaceId: log.id
    logs: [ { categoryGroup: 'audit', enabled: true } ]
  }
}

// ---------------------------------------------------------------------------
// Azure SQL: Entra-only sign-in, TLS 1.2, auditing to Log Analytics (D6, D8)
// ---------------------------------------------------------------------------
resource sql 'Microsoft.Sql/servers@2023-08-01-preview' = if (backend) {
  name: names.sql
  location: location
  tags: tags
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: sqlAdminGroupName
      sid: sqlAdminGroupId
      tenantId: subscription().tenantId
      principalType: 'Group'
    }
  }
}

// Function Apps on Flex Consumption have no fixed outbound addresses, so Azure services
// are allowed through. Production can move to a private endpoint (see docs/ARCHITECTURE.md).
resource sqlAllowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = if (backend) {
  parent: sql
  name: 'AllowAllWindowsAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource sqldb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = if (backend) {
  parent: sql
  name: names.sqldb
  location: location
  tags: tags
  sku: sqlSku == 'Basic' ? { name: 'Basic', tier: 'Basic' } : { name: sqlSku, tier: 'Standard' }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    requestedBackupStorageRedundancy: 'Local'
  }
}

resource sqlAuditing 'Microsoft.Sql/servers/auditingSettings@2023-08-01-preview' = if (backend) {
  parent: sql
  name: 'default'
  properties: {
    state: 'Enabled'
    isAzureMonitorTargetEnabled: true
  }
}

// Server-level audit events are collected through the master database's diagnostic setting.
resource sqlMaster 'Microsoft.Sql/servers/databases@2023-08-01-preview' existing = if (backend) {
  parent: sql
  name: 'master'
}

resource sqlAuditDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (backend) {
  name: 'sql-audit-to-log-analytics'
  scope: sqlMaster
  properties: {
    workspaceId: log.id
    logs: [ { category: 'SQLSecurityAuditEvents', enabled: true } ]
  }
  dependsOn: [ sqlAuditing ]
}

// ---------------------------------------------------------------------------
// Function Apps: Flex Consumption, Node 22, Linux. One plan each (Flex is one app per plan).
// ---------------------------------------------------------------------------
var commonSettings = [
  { name: 'AzureWebJobsStorage__accountName', value: names.storage }
  { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: backend ? appi!.properties.ConnectionString : '' }
  { name: 'KEY_VAULT_URI', value: backend ? kv!.properties.vaultUri : '' }
  { name: 'SQL_SERVER', value: backend ? sql!.properties.fullyQualifiedDomainName : '' }
  { name: 'SQL_DATABASE', value: names.sqldb }
  { name: 'APP_ENVIRONMENT', value: env }
  { name: 'ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'ENTRA_CLIENT_ID', value: entraClientId }
  { name: 'PULSE_ORIGIN', value: pulseOrigin }
  { name: 'WEBSITE_TIME_ZONE_NOTE', value: 'All schedules run in UTC; Sydney times are worked out in code.' }
]

resource apiPlan 'Microsoft.Web/serverfarms@2024-04-01' = if (backend) {
  name: names.apiPlan
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { tier: 'FlexConsumption', name: 'FC1' }
  properties: { reserved: true }
}

resource api 'Microsoft.Web/sites@2024-04-01' = if (backend) {
  name: names.api
  location: location
  tags: union(tags, { role: 'api' })
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${apiIdentity!.id}': {} }
  }
  properties: {
    serverFarmId: apiPlan.id
    httpsOnly: true
    keyVaultReferenceIdentity: apiIdentity.id
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      cors: {
        allowedOrigins: concat([ pulseOrigin ], extraOrigins)
        supportCredentials: false
      }
      appSettings: concat(commonSettings, [
        { name: 'AzureWebJobsStorage__clientId', value: apiIdentity!.properties.clientId }
        { name: 'AZURE_CLIENT_ID', value: apiIdentity!.properties.clientId }
        { name: 'PULSE_COMPONENT', value: 'api' }
      ])
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage!.properties.primaryEndpoints.blob}${apiContainer}'
          authentication: { type: 'UserAssignedIdentity', userAssignedIdentityResourceId: apiIdentity.id }
        }
      }
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048 }
      runtime: { name: 'node', version: '22' }
    }
  }
  dependsOn: [ containers ]
}

resource syncPlan 'Microsoft.Web/serverfarms@2024-04-01' = if (backend) {
  name: names.syncPlan
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { tier: 'FlexConsumption', name: 'FC1' }
  properties: { reserved: true }
}

resource sync 'Microsoft.Web/sites@2024-04-01' = if (backend) {
  name: names.sync
  location: location
  tags: union(tags, { role: 'sync' })
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${syncIdentity!.id}': {} }
  }
  properties: {
    serverFarmId: syncPlan.id
    httpsOnly: true
    keyVaultReferenceIdentity: syncIdentity.id
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      appSettings: concat(commonSettings, [
        { name: 'AzureWebJobsStorage__clientId', value: syncIdentity!.properties.clientId }
        { name: 'AZURE_CLIENT_ID', value: syncIdentity!.properties.clientId }
        { name: 'PULSE_COMPONENT', value: 'sync' }
      ])
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage!.properties.primaryEndpoints.blob}${syncContainer}'
          authentication: { type: 'UserAssignedIdentity', userAssignedIdentityResourceId: syncIdentity.id }
        }
      }
      // One instance is plenty for scheduled work and keeps runs from overlapping.
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048 }
      runtime: { name: 'node', version: '22' }
    }
  }
  dependsOn: [ containers ]
}

resource apiFtpOff 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = if (backend) {
  parent: api
  name: 'ftp'
  properties: { allow: false }
}

resource syncFtpOff 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = if (backend) {
  parent: sync
  name: 'ftp'
  properties: { allow: false }
}

// ---------------------------------------------------------------------------
output staticWebAppName string = swa.name
output staticWebAppHostname string = swa.properties.defaultHostname
output backendDeployed bool = backend
output apiName string = backend ? api!.name : ''
output apiHostname string = backend ? api!.properties.defaultHostName : ''
output syncName string = backend ? sync!.name : ''
output syncHostname string = backend ? sync!.properties.defaultHostName : ''
output sqlServer string = backend ? sql!.properties.fullyQualifiedDomainName : ''
output sqlServerName string = backend ? sql!.name : ''
output sqlDatabase string = names.sqldb
output keyVaultName string = backend ? kv!.name : ''
output apiIdentityClientId string = backend ? apiIdentity!.properties.clientId : ''
output syncIdentityClientId string = backend ? syncIdentity!.properties.clientId : ''
