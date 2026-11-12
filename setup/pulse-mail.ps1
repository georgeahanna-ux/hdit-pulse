# =============================================================================
# HD IT Pulse — the mailbox the weekly summary comes from (0.9.0, D12)
#
# Run in Azure Cloud Shell (PowerShell), as your usual Azure account:
#   ./pulse-mail.ps1                                  # pulse@<the tenancy's default domain>
#   ./pulse-mail.ps1 -Mailbox pulse@hdit.com.au       # or a mailbox you name
# It signs in to Exchange Online separately: use ADMIN@HDITTESTINGTENANCY.onmicrosoft.com when asked.
#
# What it does (safe to run again):
#   1. Creates the shared mailbox "HD IT Pulse" if it doesn't exist (shared mailboxes need no licence).
#   2. Lets Pulse's sync service send mail from that one mailbox and nothing else, using Exchange
#      Online's RBAC for Applications (role "Application Mail.Send", scoped to the mailbox).
#      No Microsoft Graph Mail.Send permission is granted in Entra, so Pulse can't send as anyone else.
#   3. Checks the permission, and prints the address to enter on Pulse's Connections page.
# =============================================================================
param(
  [string]$Mailbox = "",
  [string]$ResourceGroup = "rg-hdit-pulse-test-aue",
  [string]$SyncIdentity = "id-hdit-pulse-sync-test-aue",
  [string]$ScopeName = "HD IT Pulse sender (Test)"
)
$ErrorActionPreference = "Stop"
function Ok($m) { Write-Host "  OK  $m" -ForegroundColor Green }

# Run in a clean PowerShell session. Cloud Shell's profile loads other modules (Az, Microsoft Graph)
# that bring their own copy of Microsoft.OData.Core, and Exchange Online's module then can't load its own.
if (-not $env:PULSE_MAIL_CLEAN) {
  $env:PULSE_MAIL_CLEAN = "1"
  $pass = foreach ($k in $PSBoundParameters.Keys) { "-$k"; [string]$PSBoundParameters[$k] }
  pwsh -NoProfile -File $PSCommandPath @pass
  $code = $LASTEXITCODE
  Remove-Item Env:PULSE_MAIL_CLEAN -ErrorAction SilentlyContinue
  exit $code
}

# True if the lookup finds something. Exchange reports "not found" as an error, so any error counts as no.
function Found([scriptblock]$lookup) { try { [bool](& $lookup) } catch { $false } }

# The sync service's identity (its application id and its service principal's object id).
$id = az identity show -g $ResourceGroup -n $SyncIdentity --query "{appId:clientId, objectId:principalId}" -o json | ConvertFrom-Json
if (-not $id.appId) { throw "Couldn't find $SyncIdentity in $ResourceGroup. Run 'bash pulse-setup.sh release1' first." }
Ok "Sync identity $SyncIdentity ($($id.appId))"

if (-not (Get-Module -ListAvailable ExchangeOnlineManagement)) { Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force }
Import-Module ExchangeOnlineManagement
Write-Host "Sign in to Exchange Online as ADMIN@HDITTESTINGTENANCY.onmicrosoft.com:"
Connect-ExchangeOnline -Device -ShowBanner:$false

if (-not $Mailbox) { $Mailbox = "pulse@" + ((Get-AcceptedDomain | Where-Object Default).DomainName) }

# 1. The shared mailbox.
if (-not (Found { Get-Recipient -Identity $Mailbox })) {
  New-Mailbox -Shared -Name "HD IT Pulse" -DisplayName "HD IT Pulse" -Alias ($Mailbox.Split("@")[0]) -PrimarySmtpAddress $Mailbox | Out-Null
  Ok "Created shared mailbox $Mailbox"
} else { Ok "Shared mailbox $Mailbox" }

# 2. Pulse may send from that mailbox only.
if (-not (Found { Get-ServicePrincipal -Identity $id.appId })) {
  New-ServicePrincipal -AppId $id.appId -ObjectId $id.objectId -DisplayName "HD IT Pulse sync (Test)" | Out-Null
}
Ok "Exchange knows Pulse's sync service"
if (-not (Found { Get-ManagementScope -Identity $ScopeName })) {
  New-ManagementScope -Name $ScopeName -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Mailbox'" | Out-Null
} else {
  Set-ManagementScope -Identity $ScopeName -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Mailbox'"
}
Ok "Scope '$ScopeName': only $Mailbox"
if (-not (Found { Get-ManagementRoleAssignment -RoleAssignee $id.appId -Role "Application Mail.Send" })) {
  New-ManagementRoleAssignment -App $id.appId -Role "Application Mail.Send" -CustomResourceScope $ScopeName | Out-Null
}
Ok "Pulse can send as $Mailbox (and no other mailbox)"

# 3. Check.
Write-Host ""
Test-ServicePrincipalAuthorization -Identity $id.appId -Resource $Mailbox | Format-Table RoleName, InScope -AutoSize
Disconnect-ExchangeOnline -Confirm:$false | Out-Null
Write-Host ""
Write-Host "Done. In Pulse: Connections -> Microsoft Teams and email -> Sender: $Mailbox, then Send me a test."
Write-Host "(Exchange can take up to an hour to apply a new permission. If the test says 'Access is denied', try again later.)"
