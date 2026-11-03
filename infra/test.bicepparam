using './main.bicep'

param app = 'pulse'
param env = 'test'
param swaSku = 'Free'
param sqlSku = 'Basic'
param logRetentionDays = 30
param kvPurgeProtection = false

// HD IT Pulse (Test) app registration in the HD IT Testing Tenancy.
param entraTenantId = '0b1e12e5-f6cd-4ae7-a9ff-4562637a0c44'
param entraClientId = '1b247714-1319-4edf-9115-de80b3360561'

// Printed by `bash pulse-setup.sh release1-entra`. While empty, only the Static Web App is deployed.
param sqlAdminGroupId = '3cca1960-8cac-4bce-8e61-448f72cb27b8'   // Pulse - SQL Admins (Test)
