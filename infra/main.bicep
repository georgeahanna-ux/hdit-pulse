// =============================================================================
// HD IT Pulse — Azure infrastructure
//
// Pulse is a static front end: sign-in happens in the browser against Entra ID,
// and each app keeps its own backend. So the only resource here is the Static Web App.
//
// Deployed by GitHub Actions into an EXISTING resource group using the deploy identity
// id-hdit-pulse-deploy-<env>-aue (Contributor on the resource group). setup/pulse-setup.sh
// creates the resource group, that identity and this Static Web App up front, so the
// app's address is known before the Entra app registration is made.
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

@description('Static Web Apps are not offered in Australia; East Asia is the nearest. Content is still served from the global edge.')
param swaLocation string = 'eastasia'

@description('Tags applied to every resource.')
param tags object = {
  app: app
  env: env
  owner: 'HDIT'
  workload: 'hdit-pulse'
  managedBy: 'bicep'
}

var names = {
  swa: 'stapp-hdit-${app}-${env}-aue'
}

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: names.swa
  location: swaLocation
  tags: tags
  sku: { name: 'Free', tier: 'Free' }
  properties: {
    stagingEnvironmentPolicy: 'Disabled'
    allowConfigFileUpdates: true
  }
}

output staticWebAppName string = swa.name
output staticWebAppHostname string = swa.properties.defaultHostname
