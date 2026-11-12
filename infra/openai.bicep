// HD IT Pulse: Azure OpenAI for ticket sentiment (0.11.0, D23).
//
// Processing stays in Australia: a Regional *Standard* deployment in Australia East (decided by
// George 12 Nov 2026: Australia only; no Global or Data Zone deployment). Keys are switched off,
// so only Entra identities can call it: the sync service has "Cognitive Services OpenAI User" on
// the resource group (pulse-setup.sh release1). Outbound calls from the resource are blocked.
// Deployed by the workflow after main.bicep, separately, so a refusal here (quota, or Azure no
// longer taking new deployments of the model) doesn't stop the rest of Pulse deploying.

param app string = 'pulse'
param env string = 'test'
param location string = 'australiaeast'
@description('Model and version. gpt-4.1-mini is the newest model offered as Regional Standard in Australia East (Nov 2026).')
param modelName string = 'gpt-4.1-mini'
param modelVersion string = '2025-04-14'
@description('Thousands of tokens a minute.')
param capacity int = 50
param tags object = {
  app: 'pulse'
  env: env
  owner: 'HDIT'
  workload: 'hdit-pulse'
  managedBy: 'bicep'
}

var name = 'oai-hdit-${app}-${env}-aue'

resource oai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: union(tags, { role: 'ticket-sentiment' })
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: name
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    restrictOutboundNetworkAccess: true
    allowedFqdnList: []
  }
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: oai
  name: modelName
  sku: { name: 'Standard', capacity: capacity }
  properties: {
    model: { format: 'OpenAI', name: modelName, version: modelVersion }
    versionUpgradeOption: 'NoAutoUpgrade'
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

resource log 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: 'log-hdit-${app}-${env}-aue'
}

resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: oai
  properties: {
    workspaceId: log.id
    logs: [ { categoryGroup: 'audit', enabled: true } ]
    metrics: [ { category: 'AllMetrics', enabled: true } ]
  }
}

output endpoint string = oai.properties.endpoint
output deploymentName string = deployment.name
