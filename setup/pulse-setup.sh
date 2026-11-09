#!/usr/bin/env bash
# =============================================================================
# HD IT Pulse — one-off setup for the HD IT Testing Tenancy
#
# Run in Azure Cloud Shell (Bash). Upload this file (Manage files → Upload), then:
#
#   1) As your usual Azure account (the one that set up Marketing ROI):
#        bash pulse-setup.sh azure
#      Creates rg-hdit-pulse-test-aue, the GitHub deploy identity and the Pulse Static Web App.
#      Prints Pulse's address and the deploy identity's client id.
#
#   1b) Same account, for Pipeline's test environment (it hasn't had one before):
#        bash pulse-setup.sh pipeline
#      Creates rg-hdit-pipeline-test-aue, its deploy and app identities, the GitHub trust for
#      georgeahanna-ux/hdit-pipeline, and the role assignments. Prints the deploy identity's client id.
#
#   2) As ADMIN@HDITTESTINGTENANCY.onmicrosoft.com (Application or Global Administrator):
#        bash pulse-setup.sh entra <pulse-address> [extra-admin-email ...]
#      e.g. bash pulse-setup.sh entra https://nice-sea-0123.2.azurestaticapps.net george@example.com
#      Creates the "HD IT Pulse (Test)" app registration and enterprise app, its roles,
#      one security group per role, assigns each group to its role, approves Pulse for the
#      organisation, and makes you (and any extra emails) Platform Admins.
#      Prints the tenant id and the app's client id.
#
#   Release 1 (Pulse backend: database, Key Vault, two Function Apps). After steps 1 and 2:
#
#   3) As your usual Azure account:
#        bash pulse-setup.sh release1
#      Creates the identities the two Pulse Function Apps run as, the Key Vault with one
#      placeholder per integration credential, and gives each identity access to only the
#      credentials it needs (Key Vault RBAC at secret level). Prints two client ids.
#
#   4) As ADMIN@HDITTESTINGTENANCY.onmicrosoft.com:
#        bash pulse-setup.sh release1-entra
#      Refreshes the app registration (adds the release 1 roles and their groups), creates
#      the "Pulse - SQL Admins (Test)" group (you and the GitHub deploy identity), lets the
#      sync app read the three apps' numbers (Pulse.Collector) and Microsoft Graph
#      (users, group members, Planner). Prints the SQL admin group id.
#
# Every step is safe to run again: they find what already exists and only fill gaps.
# Nothing here prints or stores a secret. The app registration has no client secret.
# =============================================================================
set -euo pipefail

TENANT_EXPECTED="0b1e12e5-f6cd-4ae7-a9ff-4562637a0c44"   # HD IT Testing Tenancy
SUBSCRIPTION="1d9bced5-726c-4ef9-a4d3-63c350b6647c"
RG="rg-hdit-pulse-test-aue"
LOCATION="australiaeast"
DEPLOY_ID="id-hdit-pulse-deploy-test-aue"
SWA="stapp-hdit-pulse-test-aue"
SWA_LOCATION="eastasia"
# GitHub sends the OpenID Connect subject with owner and repository ids.
GITHUB_SUBJECT="repo:georgeahanna-ux@302303945/hdit-pulse@1430433960:environment:test"
GITHUB_SUBJECT_PLAIN="repo:georgeahanna-ux/hdit-pulse:environment:test"
APP_NAME="HD IT Pulse (Test)"
G="https://graph.microsoft.com/v1.0"
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"
GRAPH_USER_READ="e1fe6dd8-ba31-4d61-89e7-88639da4683d"
PULSE_URL_DEFAULT="https://ashy-sand-099e8e200.4.azurestaticapps.net"
API_ID="id-hdit-pulse-api-test-aue"
SYNC_ID="id-hdit-pulse-sync-test-aue"
KV="kv-hdit-pulse-test"
SQL_ADMIN_GROUP="Pulse - SQL Admins (Test)"
SECRET_WRITER_ROLE="Pulse Secret Writer (Test)"
# Graph application permissions for the sync app (no secrets: it signs in as a managed identity)
SYNC_GRAPH_PERMISSIONS="User.Read.All GroupMember.Read.All Tasks.ReadWrite.All"

# Integration credentials: secret name | who reads it | what it is. Values are entered later
# (Connections page, or Key Vault) and are never printed. "sync+" = read and write (token renewal).
SECRETS=$(cat <<'EOF'
autotask-service|api,sync|Autotask API user (one for all of Pulse; Pulse limits each module)
simplesat|sync|SimpleSAT API key, read-only
xero-app|sync|Xero app client id and secret (standard OAuth)
xero-token|sync+|Xero refresh token, renewed every run
datto-rmm|sync|Datto RMM API key and secret, read-only
itglue|sync|IT Glue API key, read-only
EOF
)

ok()   { printf '  \033[32mOK\033[0m  %s\n' "$*"; }
info() { printf '      %s\n' "$*"; }
warn() { printf '  \033[33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\n\033[31mStopped:\033[0m %s\n' "$*" >&2; exit 1; }
newid() { cat /proc/sys/kernel/random/uuid; }

# role value | display name | description | group name
ROLES=$(cat <<'EOF'
Pulse.Admin|Platform administrator|Every Pulse app as an administrator, plus the Pulse access page.|Pulse - Platform Admins
Pulse.User|Pulse user|Sign in to Pulse and see dashboards as they are switched on.|Pulse - All Staff
Pipeline.User|Pipeline user|Pipeline: view and update opportunities.|Pulse - Pipeline Users
Pipeline.Admin|Pipeline administrator|Pipeline: everything, plus Settings.|Pulse - Pipeline Admins
MarketingROI.User|Marketing ROI user|Marketing ROI: view the funnel, move leads, log contacts.|Pulse - Marketing ROI Users
MarketingROI.Admin|Marketing ROI administrator|Marketing ROI: everything, plus events, costs and Settings.|Pulse - Marketing ROI Admins
Whitespace.User|Whitespace viewer|Whitespace Matrix: view only.|Pulse - Whitespace Users
Whitespace.Editor|Whitespace editor|Whitespace Matrix: edit cells, contracts and hidden items.|Pulse - Whitespace Editors
Whitespace.Admin|Whitespace administrator|Whitespace Matrix: everything, plus the service catalogue and Settings.|Pulse - Whitespace Admins
Pulse.Leadership|Leadership|Every division; override any measurable; change Autotask departments.|Pulse - Leadership
Pulse.FinanceDetail|Finance detail|Full P&L, wages and per-client profitability.|Pulse - Finance Detail
Pulse.Compliance|Compliance|Audit log and the quarterly access review.|Pulse - Compliance
Pulse.ProjectManager|Project Manager|Projects: every project, reschedule tasks, log time on any task, resource planning.|Pulse - Project Managers
Division.Finance|Finance & Accounts|Finance & Accounts division in full; override its measurables.|Pulse - Division Finance
Division.People|People (HR)|People division in full; override its measurables.|Pulse - Division People
Division.SalesMarketing|Sales & Marketing|Sales & Marketing division in full; override its measurables.|Pulse - Division Sales and Marketing
Division.InnovationCompliance|Innovation & Compliance|Innovation & Compliance division in full; override its measurables.|Pulse - Division Innovation and Compliance
Division.ManagedServices|Managed Services|Managed Services division in full; override its measurables.|Pulse - Division Managed Services
Pulse.Collector|Pulse collector (application)|Lets the Pulse sync service read each app's Scorecard numbers.|(application)
EOF
)

need() { command -v "$1" >/dev/null 2>&1 || die "$1 isn't available. Use Azure Cloud Shell (Bash)."; }

# -----------------------------------------------------------------------------
azure_step() {
  need az
  echo; echo "HD IT Pulse: Azure resources (test)"; echo
  az account set --subscription "$SUBSCRIPTION" 2>/dev/null || die "You can't see subscription $SUBSCRIPTION. Sign in to Cloud Shell with the account you used for Marketing ROI."
  local tid; tid=$(az account show --query tenantId -o tsv)
  [ "$tid" = "$TENANT_EXPECTED" ] || die "This is tenant $tid, not the HD IT Testing Tenancy ($TENANT_EXPECTED)."
  ok "Subscription $(az account show --query name -o tsv)"

  for p in Microsoft.Web Microsoft.ManagedIdentity; do az provider register --namespace "$p" -o none; done

  az group create -n "$RG" -l "$LOCATION" --tags app=pulse env=test owner=HDIT workload=hdit-pulse -o none
  ok "Resource group $RG"

  if ! az identity show -g "$RG" -n "$DEPLOY_ID" -o none 2>/dev/null; then
    az identity create -g "$RG" -n "$DEPLOY_ID" -l "$LOCATION" --tags app=pulse env=test -o none
  fi
  local cid pid; cid=$(az identity show -g "$RG" -n "$DEPLOY_ID" --query clientId -o tsv); pid=$(az identity show -g "$RG" -n "$DEPLOY_ID" --query principalId -o tsv)
  ok "Deploy identity $DEPLOY_ID"

  local subject="$GITHUB_SUBJECT"
  case "$subject" in *1430433960*) subject="$GITHUB_SUBJECT_PLAIN"; warn "Repository id not filled in; using $subject. If the first deploy fails with AADSTS700213, update the subject to the one in the error.";; esac
  if az identity federated-credential show -g "$RG" --identity-name "$DEPLOY_ID" -n github-test -o none 2>/dev/null; then
    az identity federated-credential update -g "$RG" --identity-name "$DEPLOY_ID" -n github-test \
      --issuer https://token.actions.githubusercontent.com --subject "$subject" --audiences api://AzureADTokenExchange -o none
  else
    az identity federated-credential create -g "$RG" --identity-name "$DEPLOY_ID" -n github-test \
      --issuer https://token.actions.githubusercontent.com --subject "$subject" --audiences api://AzureADTokenExchange -o none
  fi
  ok "GitHub sign-in for georgeahanna-ux/hdit-pulse (environment: test)"

  if ! az staticwebapp show -n "$SWA" -g "$RG" -o none 2>/dev/null; then
    az staticwebapp create -n "$SWA" -g "$RG" -l "$SWA_LOCATION" --sku Free --tags app=pulse env=test owner=HDIT -o none
  fi
  local host; host=$(az staticwebapp show -n "$SWA" -g "$RG" --query defaultHostname -o tsv)
  ok "Static Web App $SWA"

  local scope; scope=$(az group show -n "$RG" --query id -o tsv)
  if [ -z "$(az role assignment list --assignee "$pid" --role Contributor --scope "$scope" --query '[0].id' -o tsv 2>/dev/null)" ]; then
    info "Waiting 30 seconds for the new identity to be ready…"; sleep 30
    az role assignment create --assignee-object-id "$pid" --assignee-principal-type ServicePrincipal --role Contributor --scope "$scope" -o none
  fi
  ok "Deploy identity is Contributor on $RG"

  echo
  echo "Done. Paste these two lines back to Claude:"
  echo
  echo "  PULSE_URL=https://$host"
  echo "  PULSE_DEPLOY_CLIENT_ID=$cid"
  echo
  echo "Next, sign in to Cloud Shell as ADMIN@HDITTESTINGTENANCY.onmicrosoft.com and run:"
  echo "  bash pulse-setup.sh entra https://$host"
  echo
}

# -----------------------------------------------------------------------------
pipeline_step() {
  need az
  echo; echo "Pipeline: Azure resources (test)"; echo
  local RG="rg-hdit-pipeline-test-aue" DEPLOY="id-hdit-pipeline-deploy-test-aue" FUNC="id-hdit-pipeline-func-test-aue"
  local SUBJ="repo:georgeahanna-ux@302303945/hdit-pipeline@1430410857:environment:test"
  az account set --subscription "$SUBSCRIPTION" 2>/dev/null || die "You can't see subscription $SUBSCRIPTION. Sign in to Cloud Shell with the account you used for Marketing ROI."
  [ "$(az account show --query tenantId -o tsv)" = "$TENANT_EXPECTED" ] || die "This isn't the HD IT Testing Tenancy."
  for p in Microsoft.Web Microsoft.KeyVault Microsoft.Storage Microsoft.Insights Microsoft.OperationalInsights Microsoft.ManagedIdentity; do az provider register --namespace "$p" -o none; done
  az group create -n "$RG" -l "$LOCATION" --tags app=pipeline env=test owner=HDIT workload=hdit-pipeline -o none
  ok "Resource group $RG"
  local id
  for id in "$DEPLOY" "$FUNC"; do
    az identity show -g "$RG" -n "$id" -o none 2>/dev/null || az identity create -g "$RG" -n "$id" -l "$LOCATION" --tags app=pipeline env=test -o none
    ok "Identity $id"
  done
  if az identity federated-credential show -g "$RG" --identity-name "$DEPLOY" -n github-test -o none 2>/dev/null; then
    az identity federated-credential update -g "$RG" --identity-name "$DEPLOY" -n github-test --issuer https://token.actions.githubusercontent.com --subject "$SUBJ" --audiences api://AzureADTokenExchange -o none
  else
    az identity federated-credential create -g "$RG" --identity-name "$DEPLOY" -n github-test --issuer https://token.actions.githubusercontent.com --subject "$SUBJ" --audiences api://AzureADTokenExchange -o none
  fi
  ok "GitHub sign-in for georgeahanna-ux/hdit-pipeline (environment: test)"
  local scope dpid fpid me
  scope=$(az group show -n "$RG" --query id -o tsv)
  dpid=$(az identity show -g "$RG" -n "$DEPLOY" --query principalId -o tsv)
  fpid=$(az identity show -g "$RG" -n "$FUNC" --query principalId -o tsv)
  me=$(az ad signed-in-user show --query id -o tsv)
  info "Waiting 30 seconds for the identities to be ready…"; sleep 30
  grant() {  # principal-id principal-type role
    if [ -z "$(az role assignment list --assignee "$1" --role "$3" --scope "$scope" --query '[0].id' -o tsv 2>/dev/null)" ]; then
      az role assignment create --assignee-object-id "$1" --assignee-principal-type "$2" --role "$3" --scope "$scope" -o none
    fi
  }
  grant "$dpid" ServicePrincipal Contributor && ok "Deploy identity: Contributor"
  local r
  for r in "Key Vault Secrets Officer" "Storage Blob Data Owner" "Storage Queue Data Contributor" "Storage Table Data Contributor" "Monitoring Metrics Publisher"; do
    grant "$fpid" ServicePrincipal "$r" && ok "App identity: $r"
  done
  grant "$me" User "Key Vault Secrets Officer" && ok "You: Key Vault Secrets Officer"
  echo
  echo "Done. Paste this line back to Claude:"
  echo
  echo "  PIPELINE_DEPLOY_CLIENT_ID=$(az identity show -g "$RG" -n "$DEPLOY" --query clientId -o tsv)"
  echo
}

# -----------------------------------------------------------------------------
graph() { az rest --only-show-errors "$@"; }

entra_step() {
  need az; need jq
  local pulse_url="${1:-}"; shift || true
  pulse_url="${pulse_url%/}"
  [[ "$pulse_url" =~ ^https://[a-z0-9.-]+$ ]] || die "Give Pulse's address, e.g. bash pulse-setup.sh entra https://nice-sea-0123.2.azurestaticapps.net"
  echo; echo "HD IT Pulse: Entra ID (HD IT Testing Tenancy)"; echo

  local me tid
  me=$(az ad signed-in-user show --query id -o tsv 2>/dev/null) || die "Couldn't read your account. Run: az login --tenant $TENANT_EXPECTED --allow-no-subscriptions"
  tid=$(graph --method GET --uri "$G/organization?\$select=id" --query 'value[0].id' -o tsv)
  [ "$tid" = "$TENANT_EXPECTED" ] || die "This is tenant $tid, not the HD IT Testing Tenancy ($TENANT_EXPECTED). Sign in as ADMIN@HDITTESTINGTENANCY.onmicrosoft.com."
  ok "Signed in as $(az ad signed-in-user show --query userPrincipalName -o tsv)"

  # ---- the app registration (roles and scope keep their ids on re-runs) ----
  local existing app_obj app_id
  existing=$(graph --method GET --uri "$G/applications" --url-parameters "\$filter=displayName eq '$APP_NAME'" "\$select=id,appId,appRoles,api" --query 'value[0]' -o json)
  if [ -z "$existing" ] || [ "$existing" = "null" ]; then existing='{}'; fi

  local roles_json='[]' line value dname desc group rid
  while IFS='|' read -r value dname desc group; do
    rid=$(jq -r --arg v "$value" '(.appRoles // [])[] | select(.value==$v) | .id' <<<"$existing")
    [ -n "$rid" ] || rid=$(newid)
    local mtype="User"; [ "$group" = "(application)" ] && mtype="Application"
    roles_json=$(jq --arg id "$rid" --arg v "$value" --arg n "$dname" --arg d "$desc" --arg t "$mtype" \
      '. + [{allowedMemberTypes:[$t], id:$id, value:$v, displayName:$n, description:$d, isEnabled:true}]' <<<"$roles_json")
  done <<<"$ROLES"
  # keep any role added by hand, so an update never tries to delete one
  roles_json=$(jq -n --argjson mine "$roles_json" --argjson ex "$existing" \
    '$mine + (($ex.appRoles // []) | map(select(.value as $v | ($mine | map(.value) | index($v)) == null)))')

  local scope_id
  scope_id=$(jq -r '(.api.oauth2PermissionScopes // [])[] | select(.value=="access_as_user") | .id' <<<"$existing")
  [ -n "$scope_id" ] || scope_id=$(newid)

  local body
  body=$(jq -n --arg name "$APP_NAME" --arg redirect "$pulse_url/" --arg sid "$scope_id" --argjson roles "$roles_json" \
    --arg graph "$GRAPH_APP_ID" --arg userread "$GRAPH_USER_READ" '{
      displayName: $name,
      signInAudience: "AzureADMyOrg",
      notes: "HD IT Pulse sign-in. Managed by setup/pulse-setup.sh in georgeahanna-ux/hdit-pulse.",
      spa: { redirectUris: [ $redirect ] },
      web: { implicitGrantSettings: { enableIdTokenIssuance: false, enableAccessTokenIssuance: false } },
      api: { requestedAccessTokenVersion: 2, oauth2PermissionScopes: [ {
        id: $sid, value: "access_as_user", type: "User", isEnabled: true,
        adminConsentDisplayName: "Use HD IT Pulse apps", adminConsentDescription: "Lets HD IT Pulse and the apps inside it act as the signed-in person.",
        userConsentDisplayName: "Use HD IT Pulse apps", userConsentDescription: "Lets HD IT Pulse and the apps inside it act as you." } ] },
      appRoles: $roles,
      requiredResourceAccess: [ { resourceAppId: $graph, resourceAccess: [ { id: $userread, type: "Scope" } ] } ]
    }')

  if [ "$existing" = "{}" ]; then
    app_obj=$(graph --method POST --uri "$G/applications" --headers "Content-Type=application/json" --body "$body" --query id -o tsv)
    ok "Created app registration \"$APP_NAME\""
  else
    app_obj=$(jq -r .id <<<"$existing")
    graph --method PATCH --uri "$G/applications/$app_obj" --headers "Content-Type=application/json" --body "$body" -o none
    ok "Updated app registration \"$APP_NAME\""
  fi
  app_id=$(graph --method GET --uri "$G/applications/$app_obj?\$select=appId" --query appId -o tsv)

  # Its own API: api://<client id>, and permission to call it.
  graph --method PATCH --uri "$G/applications/$app_obj" --headers "Content-Type=application/json" --body "$(jq -n --arg app "$app_id" --arg sid "$scope_id" --arg graph "$GRAPH_APP_ID" --arg userread "$GRAPH_USER_READ" '{
    identifierUris: [ ("api://" + $app) ],
    requiredResourceAccess: [
      { resourceAppId: $graph, resourceAccess: [ { id: $userread, type: "Scope" } ] },
      { resourceAppId: $app,   resourceAccess: [ { id: $sid, type: "Scope" } ] } ] }')" -o none
  ok "API api://$app_id with scope access_as_user; sign-in address $pulse_url/"

  # ---- the enterprise app: only assigned people can sign in ----
  local sp
  sp=$(graph --method GET --uri "$G/servicePrincipals" --url-parameters "\$filter=appId eq '$app_id'" --query 'value[0].id' -o tsv)
  if [ -z "$sp" ] || [ "$sp" = "None" ]; then
    for i in 1 2 3 4 5; do
      sp=$(graph --method POST --uri "$G/servicePrincipals" --headers "Content-Type=application/json" \
        --body "{\"appId\":\"$app_id\",\"appRoleAssignmentRequired\":true,\"tags\":[\"WindowsAzureActiveDirectoryIntegratedApp\",\"HideApp\"]}" --query id -o tsv 2>/dev/null) && break
      sleep 6
    done
    [ -n "$sp" ] || die "Couldn't create the enterprise app. Run the script again in a minute."
  fi
  graph --method PATCH --uri "$G/servicePrincipals/$sp" --headers "Content-Type=application/json" --body '{"appRoleAssignmentRequired":true}' -o none
  ok "Enterprise app: only people assigned through Pulse groups can sign in"

  # ---- approve for the organisation (no consent prompts for staff) ----
  local graph_sp grant
  graph_sp=$(graph --method GET --uri "$G/servicePrincipals" --url-parameters "\$filter=appId eq '$GRAPH_APP_ID'" --query 'value[0].id' -o tsv)
  for pair in "$sp|access_as_user" "$graph_sp|openid profile email offline_access User.Read"; do
    local res="${pair%%|*}" scopes="${pair#*|}"
    grant=$(graph --method GET --uri "$G/oauth2PermissionGrants" --url-parameters "\$filter=clientId eq '$sp' and resourceId eq '$res' and consentType eq 'AllPrincipals'" --query 'value[0].id' -o tsv)
    if [ -n "$grant" ] && [ "$grant" != "None" ]; then
      graph --method PATCH --uri "$G/oauth2PermissionGrants/$grant" --headers "Content-Type=application/json" --body "{\"scope\":\"$scopes\"}" -o none
    else
      graph --method POST --uri "$G/oauth2PermissionGrants" --headers "Content-Type=application/json" \
        --body "{\"clientId\":\"$sp\",\"consentType\":\"AllPrincipals\",\"resourceId\":\"$res\",\"scope\":\"$scopes\"}" -o none
    fi
  done
  ok "Approved for the organisation (admin consent)"

  # ---- one security group per role, assigned to that role ----
  local assigned role_ids gid nick app_roles
  app_roles=$(graph --method GET --uri "$G/applications/$app_obj?\$select=appRoles" -o json)
  assigned=$(graph --method GET --uri "$G/servicePrincipals/$sp/appRoleAssignedTo?\$top=999" -o json)
  local group_ok=1 platform_gid=""
  while IFS='|' read -r value dname desc group; do
    [ "$group" = "(application)" ] && continue   # assigned to a service, not a group
    gid=$(graph --method GET --uri "$G/groups" --url-parameters "\$filter=displayName eq '$group'" --query 'value[0].id' -o tsv)
    if [ -z "$gid" ] || [ "$gid" = "None" ]; then
      nick=$(echo "$group" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-*$//')
      gid=$(graph --method POST --uri "$G/groups" --headers "Content-Type=application/json" --body "$(jq -n --arg n "$group" --arg m "$nick" --arg d "$dname in HD IT Pulse: $desc" \
        '{displayName:$n, mailNickname:$m, description:$d, mailEnabled:false, securityEnabled:true}')" --query id -o tsv)
      ok "Created group \"$group\""
    else
      info "Group \"$group\" already exists"
    fi
    [ "$value" = "Pulse.Admin" ] && platform_gid="$gid"
    rid=$(jq -r --arg v "$value" '.appRoles[] | select(.value==$v) | .id' <<<"$app_roles")
    if jq -e --arg p "$gid" --arg r "$rid" '.value[] | select(.principalId==$p and .appRoleId==$r)' <<<"$assigned" >/dev/null; then
      info "  already assigned to $value"
    elif graph --method POST --uri "$G/servicePrincipals/$sp/appRoleAssignedTo" --headers "Content-Type=application/json" \
        --body "{\"principalId\":\"$gid\",\"resourceId\":\"$sp\",\"appRoleId\":\"$rid\"}" -o none 2>/tmp/pulse-assign.err; then
      ok "  assigned to role $value"
    else
      group_ok=0
      warn "  couldn't assign the group to $value: $(tr '\n' ' ' </tmp/pulse-assign.err | cut -c1-200)"
    fi
  done <<<"$ROLES"

  # ---- Platform Admins: you, plus any extra emails ----
  local people=("$me") who uid
  for who in "$@"; do
    uid=$(graph --method GET --uri "$G/users" --url-parameters "\$filter=userPrincipalName eq '$who' or mail eq '$who'" --query 'value[0].id' -o tsv 2>/dev/null || true)
    if [ -n "$uid" ] && [ "$uid" != "None" ]; then people+=("$uid"); else warn "No user found for $who (skipped)"; fi
  done
  local admin_rid; admin_rid=$(jq -r '.appRoles[] | select(.value=="Pulse.Admin") | .id' <<<"$app_roles")
  for uid in "${people[@]}"; do
    graph --method POST --uri "$G/groups/$platform_gid/members/\$ref" --headers "Content-Type=application/json" \
      --body "{\"@odata.id\":\"$G/directoryObjects/$uid\"}" -o none 2>/dev/null || true
    if [ "$group_ok" = 0 ]; then
      # Without Entra ID P1, groups can't be assigned to roles: assign the person directly instead.
      graph --method POST --uri "$G/servicePrincipals/$sp/appRoleAssignedTo" --headers "Content-Type=application/json" \
        --body "{\"principalId\":\"$uid\",\"resourceId\":\"$sp\",\"appRoleId\":\"$admin_rid\"}" -o none 2>/dev/null || true
    fi
  done
  ok "Platform Admins: you$( [ $# -gt 0 ] && echo " and $*" )"

  if [ "$group_ok" = 0 ]; then
    echo
    warn "Groups couldn't be assigned to roles. That needs Entra ID P1 (included in Microsoft 365 Business Premium)."
    info "Until then, assign people to roles directly: Entra admin centre → Enterprise applications → $APP_NAME → Users and groups → Add."
  fi

  echo
  echo "Done. Paste these two lines back to Claude:"
  echo
  echo "  ENTRA_TENANT_ID=$tid"
  echo "  ENTRA_CLIENT_ID=$app_id"
  echo
  echo "To give someone access, add them to a \"Pulse - …\" group in the Entra admin centre."
  echo
}

# -----------------------------------------------------------------------------
# Release 1, Azure side: Function identities, Key Vault, secret-level access
# -----------------------------------------------------------------------------
release1_step() {
  need az; need jq
  echo; echo "HD IT Pulse release 1: Azure (test)"; echo
  az account set --subscription "$SUBSCRIPTION" 2>/dev/null || die "You can't see subscription $SUBSCRIPTION. Sign in to Cloud Shell with the account you used for Marketing ROI."
  [ "$(az account show --query tenantId -o tsv)" = "$TENANT_EXPECTED" ] || die "This isn't the HD IT Testing Tenancy."
  az group show -n "$RG" -o none 2>/dev/null || die "Resource group $RG doesn't exist. Run: bash pulse-setup.sh azure"
  local p
  for p in Microsoft.Web Microsoft.KeyVault Microsoft.Storage Microsoft.Insights Microsoft.OperationalInsights Microsoft.ManagedIdentity Microsoft.Sql; do
    az provider register --namespace "$p" -o none
  done
  ok "Resource providers registered"

  local id fresh=0
  for id in "$API_ID" "$SYNC_ID"; do
    if ! az identity show -g "$RG" -n "$id" -o none 2>/dev/null; then
      az identity create -g "$RG" -n "$id" -l "$LOCATION" --tags app=pulse env=test owner=HDIT -o none; fresh=1
    fi
    ok "Identity $id"
  done
  if [ "$fresh" = 1 ]; then info "Waiting 30 seconds for the new identities to be ready…"; sleep 30; fi

  local scope apip syncp me
  scope=$(az group show -n "$RG" --query id -o tsv)
  apip=$(az identity show -g "$RG" -n "$API_ID" --query principalId -o tsv)
  syncp=$(az identity show -g "$RG" -n "$SYNC_ID" --query principalId -o tsv)
  me=$(az ad signed-in-user show --query id -o tsv)

  grant() {  # principal-id principal-type role scope
    if [ -z "$(az role assignment list --assignee "$1" --role "$3" --scope "$4" --query '[0].id' -o tsv 2>/dev/null)" ]; then
      az role assignment create --assignee-object-id "$1" --assignee-principal-type "$2" --role "$3" --scope "$4" -o none
    fi
  }
  local r
  for r in "Storage Blob Data Owner" "Storage Queue Data Contributor" "Storage Table Data Contributor" "Monitoring Metrics Publisher"; do
    grant "$apip" ServicePrincipal "$r" "$scope"; grant "$syncp" ServicePrincipal "$r" "$scope"
  done
  ok "Both identities: storage and monitoring on $RG (no Key Vault access at this level)"

  # ---- Key Vault ----
  if az keyvault show -n "$KV" -g "$RG" -o none 2>/dev/null; then
    ok "Key Vault $KV"
  elif [ -n "$(az keyvault list-deleted --query "[?name=='$KV'].name" -o tsv 2>/dev/null)" ]; then
    az keyvault recover -n "$KV" -o none
    ok "Recovered soft-deleted Key Vault $KV"
  else
    az keyvault create -n "$KV" -g "$RG" -l "$LOCATION" --enable-rbac-authorization true --retention-days 90 \
      --tags app=pulse env=test owner=HDIT workload=hdit-pulse -o none
    ok "Created Key Vault $KV"
  fi
  local kvid; kvid=$(az keyvault show -n "$KV" -g "$RG" --query id -o tsv)
  grant "$me" User "Key Vault Secrets Officer" "$kvid"
  ok "You: Key Vault Secrets Officer on $KV (to enter credentials)"

  # Write-only role for the Connections page: set a secret and see its metadata, never read it.
  local roledef; roledef=$(jq -n --arg n "$SECRET_WRITER_ROLE" --arg s "$scope" '{
    Name: $n, IsCustom: true,
    Description: "Set Key Vault secrets and read their metadata, but never read secret values. Used by the HD IT Pulse Connections page.",
    Actions: [], NotActions: [],
    DataActions: [ "Microsoft.KeyVault/vaults/secrets/setSecret/action", "Microsoft.KeyVault/vaults/secrets/readMetadata/action" ],
    NotDataActions: [], AssignableScopes: [ $s ] }')
  if [ -z "$(az role definition list --name "$SECRET_WRITER_ROLE" --scope "$scope" --query '[0].id' -o tsv 2>/dev/null)" ]; then
    az role definition create --role-definition "$roledef" -o none
    info "Waiting 30 seconds for the new role to be available…"; sleep 30
    ok "Created role \"$SECRET_WRITER_ROLE\""
  else
    ok "Role \"$SECRET_WRITER_ROLE\""
  fi
  local tries=0
  until grant "$apip" ServicePrincipal "$SECRET_WRITER_ROLE" "$kvid" 2>/dev/null; do
    tries=$((tries+1)); [ $tries -ge 6 ] && die "Couldn't assign \"$SECRET_WRITER_ROLE\". Run the script again in a few minutes."
    sleep 15
  done
  ok "API identity: write-only on $KV (Connections page)"

  # ---- one placeholder per credential, and secret-level read access ----
  local name readers what sid set_ok who
  while IFS='|' read -r name readers what; do
    if ! az keyvault secret show --vault-name "$KV" -n "$name" --query id -o tsv >/dev/null 2>&1; then
      set_ok=0
      for tries in 1 2 3 4 5 6 7 8 9 10; do
        if az keyvault secret set --vault-name "$KV" -n "$name" --value "not-set" --description "$what" \
             --tags owner=unassigned rotation=unset -o none 2>/dev/null; then set_ok=1; break; fi
        [ "$tries" = 1 ] && info "Waiting for your Key Vault access to take effect (can take a few minutes)…"
        sleep 20
      done
      [ "$set_ok" = 1 ] || die "Couldn't create secret $name. Run the script again in a few minutes."
    fi
    sid="$kvid/secrets/$name"
    for who in ${readers//,/ }; do
      case "$who" in
        api)   grant "$apip"  ServicePrincipal "Key Vault Secrets User" "$sid" ;;
        sync)  grant "$syncp" ServicePrincipal "Key Vault Secrets User" "$sid" ;;
        sync+) grant "$syncp" ServicePrincipal "Key Vault Secrets Officer" "$sid" ;;
      esac
    done
    ok "Secret $name → readable by: ${readers//+/ (read and write)}"
  done <<<"$SECRETS"

  echo
  echo "Done. Paste these two lines back to Claude:"
  echo
  echo "  PULSE_API_CLIENT_ID=$(az identity show -g "$RG" -n "$API_ID" --query clientId -o tsv)"
  echo "  PULSE_SYNC_CLIENT_ID=$(az identity show -g "$RG" -n "$SYNC_ID" --query clientId -o tsv)"
  echo
  echo "Next, sign in to Cloud Shell as ADMIN@HDITTESTINGTENANCY.onmicrosoft.com and run:"
  echo "  bash pulse-setup.sh release1-entra"
  echo
}

# -----------------------------------------------------------------------------
# Release 1, Entra side: new roles and groups, SQL admin group, service permissions
# -----------------------------------------------------------------------------
sp_by_name() { graph --method GET --uri "$G/servicePrincipals" --url-parameters "\$filter=displayName eq '$1'" --query 'value[0].id' -o tsv 2>/dev/null || true; }

release1_entra_step() {
  need az; need jq
  entra_step "${1:-$PULSE_URL_DEFAULT}"     # refreshes roles and creates the new groups

  echo; echo "HD IT Pulse release 1: Entra ID"; echo
  local me; me=$(az ad signed-in-user show --query id -o tsv)
  local deploy_sp api_sp sync_sp v
  deploy_sp=$(sp_by_name "$DEPLOY_ID"); api_sp=$(sp_by_name "$API_ID"); sync_sp=$(sp_by_name "$SYNC_ID")
  for v in deploy_sp api_sp sync_sp; do
    if [ -z "${!v}" ] || [ "${!v}" = "None" ]; then
      die "Couldn't find the Pulse identities. Run 'bash pulse-setup.sh release1' first (as your Azure account)."
    fi
  done
  ok "Found the deploy, API and sync identities"

  # ---- SQL admin group: you and the GitHub deploy identity (runs database migrations) ----
  local gid
  gid=$(graph --method GET --uri "$G/groups" --url-parameters "\$filter=displayName eq '$SQL_ADMIN_GROUP'" --query 'value[0].id' -o tsv)
  if [ -z "$gid" ] || [ "$gid" = "None" ]; then
    gid=$(graph --method POST --uri "$G/groups" --headers "Content-Type=application/json" --body "$(jq -n --arg n "$SQL_ADMIN_GROUP" \
      '{displayName:$n, mailNickname:"pulse-sql-admins-test", description:"Administrators of the HD IT Pulse test database. Keep to Platform Admins and the GitHub deploy identity.", mailEnabled:false, securityEnabled:true}')" --query id -o tsv)
    ok "Created group \"$SQL_ADMIN_GROUP\""
  else
    ok "Group \"$SQL_ADMIN_GROUP\""
  fi
  local m
  for m in "$me" "$deploy_sp"; do
    graph --method POST --uri "$G/groups/$gid/members/\$ref" --headers "Content-Type=application/json" \
      --body "{\"@odata.id\":\"$G/directoryObjects/$m\"}" -o none 2>/dev/null || true
  done
  ok "Members: you and $DEPLOY_ID"

  # ---- Pulse.Collector for the sync identity ----
  local app_id pulse_sp rid
  app_id=$(graph --method GET --uri "$G/applications" --url-parameters "\$filter=displayName eq '$APP_NAME'" --query 'value[0].appId' -o tsv)
  pulse_sp=$(graph --method GET --uri "$G/servicePrincipals" --url-parameters "\$filter=appId eq '$app_id'" --query 'value[0].id' -o tsv)
  rid=$(graph --method GET --uri "$G/servicePrincipals/$pulse_sp?\$select=appRoles" -o json | jq -r '.appRoles[] | select(.value=="Pulse.Collector") | .id')
  assign_app_role() {  # principal-sp resource-sp role-id label
    if graph --method GET --uri "$G/servicePrincipals/$1/appRoleAssignments" -o json | jq -e --arg r "$3" --arg s "$2" '.value[] | select(.appRoleId==$r and .resourceId==$s)' >/dev/null; then
      info "$4 (already)"
    else
      graph --method POST --uri "$G/servicePrincipals/$1/appRoleAssignments" --headers "Content-Type=application/json" \
        --body "{\"principalId\":\"$1\",\"resourceId\":\"$2\",\"appRoleId\":\"$3\"}" -o none
      ok "$4"
    fi
  }
  assign_app_role "$sync_sp" "$pulse_sp" "$rid" "Sync identity: Pulse.Collector"

  # ---- Microsoft Graph application permissions for the sync identity ----
  local graph_sp graph_roles perm
  graph_sp=$(graph --method GET --uri "$G/servicePrincipals" --url-parameters "\$filter=appId eq '$GRAPH_APP_ID'" --query 'value[0].id' -o tsv)
  graph_roles=$(graph --method GET --uri "$G/servicePrincipals/$graph_sp?\$select=appRoles" -o json)
  for perm in $SYNC_GRAPH_PERMISSIONS; do
    rid=$(jq -r --arg v "$perm" '.appRoles[] | select(.value==$v) | .id' <<<"$graph_roles")
    [ -n "$rid" ] || die "Microsoft Graph has no permission called $perm."
    assign_app_role "$sync_sp" "$graph_sp" "$rid" "Sync identity: Microsoft Graph $perm"
  done

  echo
  echo "Done. Paste this line back to Claude:"
  echo
  echo "  SQL_ADMIN_GROUP_ID=$gid"
  echo
  echo "Add people to the new groups (Pulse - Leadership, Pulse - Division …) in the Entra admin centre."
  echo
}

case "${1:-}" in
  azure) azure_step ;;
  pipeline) pipeline_step ;;
  entra) shift; entra_step "$@" ;;
  release1) release1_step ;;
  release1-entra) shift; release1_entra_step "$@" ;;
  *) sed -n '2,44p' "$0"; exit 1 ;;
esac
