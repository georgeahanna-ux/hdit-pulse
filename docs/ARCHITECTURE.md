# HD IT Pulse: release 1 architecture and build plan

**Status:** approved by George, 31 October 2026. Builds on `REQUIREMENTS.md` (D1–D17) and `IDENTITY-AND-ACCESS.md`.

## 1. What changes from Pulse v0.3.0

v0.3.0 is a static shell: MSAL sign-in, a nav built from app roles, and a token bridge to the three apps in iframes. Release 1 adds a backend, a database, integrations and Teams. Kept as-is: the app registration, roles-through-groups model, `pulse-setup.sh`, the `pulse:token-request` bridge, `pulse-auth.js`, the OIDC deploy identity and the GitHub workflow pattern. The shell UI is rebuilt in Brand V5.

## 2. Architecture

```
                       Microsoft Entra ID (HD IT Pulse app registration)
                        roles via groups · Conditional Access: MFA + compliant device
                                   │ access token (user)            │ app-only tokens (managed identities)
                                   ▼                                 ▼
 Browser / Teams ─────────► Pulse web (Static Web App) ──Bearer──► func-hdit-pulse-api  ──┐
  (personal app, L10 tab)    vanilla JS modules, Brand V5            user API · Teams bot   │
                             apps in iframes (token bridge)          endpoint · audit       │
                                                                                            ▼
                                                                    Azure SQL (Pulse data, temporal history)
                                                                                            ▲
 Autotask · Xero · SimpleSAT · Datto RMM ◄── read-only API users ── func-hdit-pulse-sync ──┘
 Pipeline · Marketing ROI · Whitespace   ◄── app-only token ───────  timers: hourly scorecard, nightly
 Microsoft Graph (Planner, users, mail)  ◄── managed identity ──────  directory, Planner sync, bot nudges
                                                │
                                       Key Vault (secret-scoped RBAC)
```

### Two Function Apps, not one
- **`func-hdit-pulse-api`** faces users. It reads and writes Pulse data and can only *write* integration secrets (for the Connections page), never read them. It reads two secrets: the Autotask Service API user (for "Issue → Autotask ticket") and the Autotask People Admin API user (for default-department changes, D16).
- **`func-hdit-pulse-sync`** has no user-facing routes. It runs the timers and is the only thing that can read the other integration credentials. It also renews the Xero refresh token, so it can write that one secret.

This is D7's "each module reads only its own secrets": a flaw in the user-facing API can't reach Xero or Datto credentials. Each app has its own user-assigned managed identity, created and granted roles by `pulse-setup.sh` (the deploy identity can't grant roles, as with the existing apps).

### Data: Azure SQL (D6)
- Test: Basic. Production: S0. Entra-only authentication. Both Function identities are contained database users with least-privilege roles.
- **System-versioned temporal tables** on everything people edit: an automatic history of every change.
- An append-only **`audit_event`** table (who, when, what, old → new, reason, and views of sensitive pages), also sent to Log Analytics with 12-month retention (D8).
- Schema changes are numbered SQL migration files, applied by the GitHub workflow before each deploy (the deploy identity is in a "Pulse SQL admins" Entra group set as the server's Entra admin).

Main tables: `person`, `person_link` (Entra object ID → Autotask, Datto RMM, IT Glue, SimpleSAT, Quote Manager), `at_department`, `person_department` (temporal: default department over time), `division`, `seat`, `measurable`, `measurable_definition` (versioned), `scorecard_value`, `rock`, `rock_milestone`, `issue`, `todo`, `meeting`, `meeting_rating`, `vto_section`, `connection` (metadata only, never secrets), `teams_conversation`, `audit_event`.

### Access (D3, override rule)
New app roles on the existing registration, each assigned to a group, the same way as today:

| Role | Group | Gives |
|---|---|---|
| `Pulse.Leadership` | Pulse - Leadership | Every division; override any measurable; change Autotask departments |
| `Pulse.FinanceDetail` | Pulse - Finance Detail | Full P&L, wages, per-client profitability |
| `Pulse.Compliance` | Pulse - Compliance | Audit log, access review export |
| `Division.Finance`, `Division.People`, `Division.SalesMarketing`, `Division.InnovationCompliance`, `Division.ManagedServices` | Pulse - Division … | That division in full; override that division's measurables |
| `Pulse.Collector` | (the sync app's identity, not people) | Lets Pulse read the three apps' numbers |

`Pulse.Admin` and `Pulse.User` stay as they are. **Overrides:** leadership can override any measurable; everyone else only measurables owned by their division. The backend enforces this on every request.

### The Scorecard engine (D1, D4, D5)
- **Week:** Monday to Sunday, Australia/Sydney. **Lock:** Tuesday 5pm Sydney after the week ends, worked out from the clock, not a timer.
- **Hourly collector** (sync app) computes each automatic measurable for the open week. It never touches a locked week or an override. Monthly measurables are *provisional* until Finance closes the month.
- **Overrides:** that week only; mandatory reason; automatic value kept beside it; revertible with a reason; all audited.
- **Two weeks off target → suggested Issue** for the next L10.

| Measurables | Read by | How |
|---|---|---|
| MQLs (1) | Marketing ROI | `GET /api/pulse/measures`, app-only token with `Pulse.Collector` |
| New MRR, weighted pipeline (2–3) | Pipeline | same |
| New seats, seats serviced (4–5) | Autotask (Finance API user: contracts) | sync app, read-only |
| SLA, tickets/tech/day, FCR, utilisation (6–9) | Autotask (Service API user) | sync app, read-only; techs = default department Service Desk (D16) |
| CSAT, NPS (10–11) | SimpleSAT | API key, read-only |
| Cash, DSO, SGM, EBITDA % (12–15) | Live Xero, read-only (D17) | standard OAuth, granular `.read` scopes, SLI reporting codes |

### Integrations (D7, D10, D11, D16, D17)
- **Microsoft Graph** via managed identity (no secrets): users and aliases for the People directory, Planner for To-dos, mail for the weekly summary (one sender mailbox, limited by an Exchange application access policy).
- **People directory:** nightly and at first sign-in, matching every Entra address against active Autotask resources, with a *Needs review* list.
- **Autotask departments (D16):** department membership synced every 15 minutes and on demand; view by department; change default department for one or many people (Platform Admins and Leadership), written to `ResourceRoleDepartments` and audited.
- **Xero (D17):** a Finance user connects once from the Connections page; refresh token in Key Vault, renewed hourly.
- **Planner:** To-dos ↔ "Pulse – L10" plan, polled every 5 minutes with ETags; last write wins; both sides audited.
- **Issue → Autotask ticket or project task:** one click, linked back.
- **Connections page:** status, last success, owner, expiry, rotation due; secrets write-only.

### Teams (D12)
- One Teams app package: personal app plus a configurable tab for the leadership channel, with Teams SSO (extra Application ID URI and Teams pre-authorised as a client: a setup-script step).
- **Bot:** Azure Bot (free channel tier) running as a user-assigned managed identity. Messaging endpoint on the API app; scheduled nudges sent by the sync app.
- Tested in the HD IT Testing Tenancy (Business Premium) with a test leadership team, then the real leadership channel in production.

### Front end
- Vanilla JavaScript, no framework and no bundler, matching the three apps. ES modules (`shell`, `scorecard`, `rocks`, `issues`, `todos`, `l10`, `vto`, `chart`, `people`, `admin`, `help`). `build.mjs` only fills in settings.
- HD IT Brand System V5.0. Every number has an ⓘ panel from `measurable_definition`.
- Help centre: user guide, FAQ, metric glossary, what's new, versioned and exportable to PDF later.

### The three apps (D9)
Brand V5 restyle; header hidden when framed by Pulse; `pulse:navigate` and `pulse:context` bridge messages; help moved into Pulse; the `/api/pulse/measures` route. Backends, Autotask users and Table Storage unchanged.

## 3. Environments and cost
Test: HD IT Testing Tenancy, Australia East (SWA content from East Asia), deploy on every push to `main`. Production deploys only from an approved GitHub release. Test estimate A$20–35/month; production within D14's ~A$90–140 with Defender. Confirm in the Azure pricing calculator before production.

## 4. Build plan (each milestone ships to test)

| # | Milestone | Contents | Version |
|---|---|---|---|
| M0 | Foundations | Bicep for SQL, Key Vault, both Function Apps; setup-script `release1` step; migrations in the workflow; shared libs (auth, SQL, audit, Sydney week); `/api/me`; Brand V5 shell; audit log | 0.4.0 |
| M1 | EOS core | Accountability Chart and seats, V/TO, Rocks, Issues, To-dos, Scorecard with manual measurables, overrides, lock, history | 0.5.0 |
| M2 | Automatic Scorecard and people | Connections page credential entry (shipped early in 0.5.1); People directory and matching, Autotask departments view and two-way changes (0.5.2); collectors for Autotask, SimpleSAT, Xero; `/api/pulse/measures` in the three apps; metric ⓘ panels | 0.6.0 |
| M3 | L10 meeting | Segue, Scorecard, Rock review, headlines, To-dos, IDS, conclude and rate; suggested Issues | 0.7.0 |
| M4 | Two-way links | Planner sync, Issue → Autotask, Rocks linked to Planner or Autotask projects | 0.8.0 |
| M5 | Teams | Teams app, SSO, tab, bot notifications, weekly email | 0.9.0 |
| M6 | Apps in Pulse | Brand V5 restyle, framed mode, deep links, help moved | — |
| M7 | Release readiness | Help centre, ISO technical documents, production workflow with approval, CA policy, Defender, pulse.hdit.com.au | 1.0.0 |

## 5. Decisions taken (31 October 2026)
1. **Xero:** live organisation in test and production, read-only by scope, standard OAuth connection (D17).
2. **Teams and Planner:** tested in the Testing Tenancy, which has Business Premium licences.
3. **Tech:** any Autotask resource whose default department is Service Desk; Pulse shows people by department and changes default departments two-way (D16).
4. **Overrides:** leadership any measurable; staff their own division's.
