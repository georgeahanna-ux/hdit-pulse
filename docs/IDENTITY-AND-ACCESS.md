# HD IT Pulse: identity and access

How people sign in to Pulse and the apps inside it, how access is decided, and how to set it up.
Tested first on the **HD IT Testing Tenancy** (`0b1e12e5-f6cd-4ae7-a9ff-4562637a0c44`), then repeated for production.

## The short version

- **One sign-in:** staff sign in to Pulse with their HD IT Microsoft 365 account (Microsoft Entra ID). MFA and Conditional Access apply as for any Microsoft app.
- **One app registration:** "HD IT Pulse" holds an **app role** per app and level (for example `Whitespace.Editor`).
- **Access by group:** each role is assigned to an Entra **security group** ("Pulse - Whitespace Editors"). Give someone access by adding them to a group; take it away by removing them. Joiners and leavers are handled in Entra, not in each app.
- **Only assigned people can sign in:** the enterprise app requires assignment, so someone in no Pulse group is turned away by Microsoft before reaching Pulse.
- **Each app checks for itself:** every backend verifies the token's signature, tenant, audience, scope and roles on every request. Hiding a menu item isn't the only lock.
- **No third-party cookies:** the earlier Microsoft 365 sign-in failed on hardened laptops because it relied on cookies from another web address. Pulse uses MSAL (authorization code + PKCE) and sends tokens as request headers; apps inside Pulse receive theirs from Pulse over `postMessage`. Nothing depends on cookies.
- **No secrets:** the app registration is a public client with no client secret. There's nothing to rotate.

## How it fits together

```
 Browser                                   Microsoft Entra ID
 ┌──────────────────────────────┐   sign-in (redirect, PKCE)   ┌─────────────────────────┐
 │ HD IT Pulse (Static Web App) │ ───────────────────────────► │ App registration        │
 │  MSAL · nav from roles       │ ◄─── access token (roles) ── │  "HD IT Pulse"          │
 │                              │                               │  roles ◄── groups       │
 │  ┌────────────────────────┐  │                               └─────────────────────────┘
 │  │ App in an iframe       │  │  token over postMessage          ▲ signing keys (JWKS)
 │  │ (exact origin only)    │◄─┼─ (Pulse ⇄ app, both check        │
 │  └──────────┬─────────────┘  │   each other's address)          │
 └─────────────┼────────────────┘                                  │
               │ Authorization: Bearer <token>                     │
               ▼                                                   │
   App backend (Azure Function) ── verifies signature, tenant, ────┘
   audience, scope, roles · matches the person to Autotask
```

### Roles and groups

| Group | Role | What it gives |
|---|---|---|
| Pulse - Platform Admins | `Pulse.Admin` | Every app as an administrator, plus the Pulse access page |
| Pulse - All Staff | `Pulse.User` | Sign in to Pulse and see dashboards as they're switched on |
| Pulse - Pipeline Users | `Pipeline.User` | Pipeline: view and update opportunities |
| Pulse - Pipeline Admins | `Pipeline.Admin` | Pipeline: everything, plus Settings |
| Pulse - Marketing ROI Users | `MarketingROI.User` | Marketing ROI: view the funnel, move leads, log contacts |
| Pulse - Marketing ROI Admins | `MarketingROI.Admin` | Marketing ROI: everything, plus events, costs and Settings |
| Pulse - Whitespace Users | `Whitespace.User` | Whitespace Matrix: view only |
| Pulse - Whitespace Editors | `Whitespace.Editor` | Whitespace Matrix: edit cells, contracts and hidden items |
| Pulse - Whitespace Admins | `Whitespace.Admin` | Whitespace Matrix: everything, plus the service catalogue and Settings |
| Pulse - Leadership | `Pulse.Leadership` | Every division; override any measurable; change Autotask default departments |
| Pulse - Finance Detail | `Pulse.FinanceDetail` | Full P&L detail, wages and per-client profitability |
| Pulse - Compliance | `Pulse.Compliance` | Audit log and the quarterly access review |
| Pulse - Project Managers | `Pulse.ProjectManager` | Projects: every project, reschedule tasks (drag in the Gantt), log time on any task, resource planning (added 9 Nov 2026) |
| Pulse - Division Finance | `Division.Finance` | Finance & Accounts in full; override its measurables |
| Pulse - Division People | `Division.People` | People (HR) in full; override its measurables |
| Pulse - Division Sales and Marketing | `Division.SalesMarketing` | Sales & Marketing in full; override its measurables |
| Pulse - Division Innovation and Compliance | `Division.InnovationCompliance` | Innovation & Compliance in full; override its measurables |
| Pulse - Division Managed Services | `Division.ManagedServices` | Managed Services in full; override its measurables |
| *(the sync service's identity, not people)* | `Pulse.Collector` | Lets Pulse read each app's Scorecard numbers |

A new app adds its own `<App>.User` / `.Admin` roles and groups the same way.

Roles are read from the token, so a change applies the next time the person signs in (or within about an hour, when Pulse quietly renews the token).

### Who the person is in Autotask

Apps write to Autotask as Pulse's single API user (the `autotask-service` secret in Pulse's Key Vault, which each app's identity can read; from 10 Nov 2026, with the app's own credentials as a fallback) and stamp changes with the person's name. The backend finds the person's Autotask resource:

1. a link they saved earlier, otherwise
2. their Microsoft 365 email against the email on active Autotask resources.

In production these emails match, so nobody is asked. In the test tenancy they won't, so each person picks their name once per app. Someone matched by email can't re-link to another name; a saved link can't be taken by a second person.

### Inside the apps

| Setting (Function App) | Purpose |
|---|---|
| `ENTRA_TENANT_ID` | Tenant that issues tokens |
| `ENTRA_CLIENT_ID` | The HD IT Pulse app's client id (the token audience) |
| `ENTRA_ROLE_PREFIX` | `Pipeline`, `MarketingROI` or `Whitespace` |
| `LEGACY_PASSWORD_LOGIN` | `on` keeps the team password working beside Pulse; `off` turns it off |

The checks live in `backend/src/lib/pulse-auth.js`, identical in every app, with tests in `backend/test/pulse-auth.test.js`. Each app's site only lets Pulse frame it (`frame-ancestors <Pulse address>`), and only accepts token messages from that exact address. Pulse only answers token requests from the iframe it created, at the app's configured address.

While `LEGACY_PASSWORD_LOGIN` is `on`, an app's own address still works with the team password. Turn it `off` per app once everyone uses Pulse; the app's own address then just offers a link into Pulse.

## Setting it up (HD IT Testing Tenancy)

Run `setup/pulse-setup.sh` in Azure Cloud Shell (Bash). Upload the file with **Manage files → Upload**. Each step can be run again safely.

1. **Azure resources**, as the account you used for Marketing ROI:
   ```bash
   bash pulse-setup.sh azure
   ```
   Creates `rg-hdit-pulse-test-aue`, the GitHub deploy identity `id-hdit-pulse-deploy-test-aue` (Contributor on that resource group only) and the Static Web App `stapp-hdit-pulse-test-aue`. Prints `PULSE_URL` and `PULSE_DEPLOY_CLIENT_ID`.

   Then, same account, Pipeline's test environment (first time Pipeline has one):
   ```bash
   bash pulse-setup.sh pipeline
   ```
   Prints `PIPELINE_DEPLOY_CLIENT_ID`. Pipeline's secrets are added after its first deploy (see `docs/AZURE-SETUP.md` in `hdit-pipeline`).

2. **Entra ID**, signed in to Cloud Shell as `ADMIN@HDITTESTINGTENANCY.onmicrosoft.com`:
   ```bash
   bash pulse-setup.sh entra <PULSE_URL> [your test-tenancy email]
   ```
   Creates the "HD IT Pulse (Test)" app registration and enterprise app, the roles, a group per role (each assigned to its role), approves Pulse for the organisation so nobody sees a consent prompt, and puts you in Platform Admins. Prints `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID`.
   - If Cloud Shell says the account has no subscription, run `az login --tenant 0b1e12e5-f6cd-4ae7-a9ff-4562637a0c44 --allow-no-subscriptions` first.
   - If the tenancy has no Entra ID P1, groups can't be assigned to roles. The script says so and assigns you directly; assign others under Enterprise applications → HD IT Pulse (Test) → Users and groups.

3. **Give Claude the five values.** They aren't secrets. Claude adds them to the Pulse and app deploy settings and pushes, which deploys everything.

4. **Add test people** to the groups, then sign in at the Pulse address.

## Release 1 setup (Pulse backend)

Release 1 adds Pulse's own backend: Azure SQL, a Key Vault, and two Function Apps (`func-hdit-pulse-api`, `func-hdit-pulse-sync`), each running as its own managed identity. See `docs/ARCHITECTURE.md`. After the steps above:

5. **Azure**, as the account you used for Marketing ROI:
   ```bash
   bash pulse-setup.sh release1
   ```
   Creates `id-hdit-pulse-api-test-aue` and `id-hdit-pulse-sync-test-aue`, the Key Vault `kv-hdit-pulse-test` with one placeholder per integration credential, and secret-level access: each identity can read only the credentials it needs. The API identity can write credentials but never read them (custom role "Pulse Secret Writer (Test)"). From 10 Nov 2026 it also lets the Pipeline, Marketing ROI and Whitespace identities (`id-hdit-<app>-func-test-aue`) read the one Autotask secret, `autotask-service`, so every app uses Pulse's Autotask API user. Prints two client ids.

6. **Entra ID**, as `ADMIN@HDITTESTINGTENANCY.onmicrosoft.com`:
   ```bash
   bash pulse-setup.sh release1-entra
   ```
   Adds the release 1 roles and their groups (table above), creates **Pulse - SQL Admins (Test)** (you and the GitHub deploy identity; the database's administrator), gives the sync identity `Pulse.Collector` and Microsoft Graph `User.Read.All`, `GroupMember.Read.All` and `Tasks.ReadWrite.All`. Prints `SQL_ADMIN_GROUP_ID`.

7. **Give Claude `SQL_ADMIN_GROUP_ID`.** It goes in `infra/test.bicepparam`; the next deploy creates the database and both Function Apps, runs the migrations and switches Pulse's front end over to its API.

8. **Add people** to Pulse - Leadership and the Pulse - Division … groups.

How the database is reached: Entra ID only (no SQL passwords). The Function identities are database users in roles `pulse_api` and `pulse_sync`, which can read and write Pulse's tables but can't change the schema or alter the audit trail. Schema changes run from GitHub Actions as the deploy identity, which briefly allows the runner's address through the SQL firewall for that run only.

## Production

Repeat with production names (`rg-hdit-pulse-prod-aue`, "HD IT Pulse") in HD IT's main tenant, run by someone with Application Administrator there. Before switching on:

- Add a **Conditional Access** policy targeting the HD IT Pulse enterprise app (require MFA and a compliant or hybrid-joined device), or confirm your existing all-apps policies cover it.
- Set `LEGACY_PASSWORD_LOGIN` to `off` for each app once its people are in Pulse.
- Keep Platform Admins small; it's administrator in every app.
- Optional: a custom domain such as `pulse.hdit.com.au` (add it to the Static Web App, then add `https://pulse.hdit.com.au/` as a redirect URI).

## Why not the alternatives

| Option | Why not (for now) |
|---|---|
| Static Web Apps built-in sign-in (`/.auth/login/aad`) | The pre-configured provider lets any Microsoft account in; locking it to one tenant needs the Standard plan per site, and it's cookie-based on each app's own address, which is what broke before. |
| A separate app registration per app | More setup and more consent for little gain; one registration with per-app roles keeps access in one place. Revisit if an app needs to be exposed outside HD IT. |
| Merging all backends into one | Each app keeps its own backend and Key Vault so apps ship independently. (Since 10 Nov 2026 they share Pulse's one Autotask API user, at HD IT's request, so there is one credential to look after; each app's code limits what it does.) |
