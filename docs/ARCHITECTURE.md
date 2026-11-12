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
- **`func-hdit-pulse-api`** faces users. It reads and writes Pulse data and can only *write* integration secrets (for the Connections page), never read them. It reads one integration secret: the single Autotask API user (Key Vault secret `autotask-service`, 9 Nov 2026), for default-department changes, project task edits and time entries. What each Pulse module may do with it is limited in code (`lib/autotask.js` `POLICY`). Pipeline, Marketing ROI and Whitespace Matrix read the same secret (each app's identity has read access to that one secret, from 10 Nov 2026); what they do with it is limited by their own code.
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
- **Hourly collector** (sync app) computes each measurable that has a collector for the open weeks (current, and the one under review until it locks), plus a one-off fill of up to 12 earlier weeks. It never changes a locked week's automatic value once set, and never touches an override. **Trial (shadow) mode** first: the automatic value is stored beside the typed-in one and only counts once Leadership switches the measurable to automatic (with a reason, audited). Shipped for the four Autotask service measurables in 0.5.3. Monthly measurables are *provisional* until Finance closes the month.
- **Overrides:** that week only; mandatory reason; automatic value kept beside it; revertible with a reason; all audited.
- **Two weeks off target → suggested Issue** for the next L10.

| Measurables | Read by | How |
|---|---|---|
| MQLs (1) | Marketing ROI | `GET /api/pulse/measures`, app-only token with `Pulse.Collector`; Marketing ROI records when each lead first reaches MQL; on trial from 0.6.5 |
| New MRR, weighted pipeline (2–3) | Autotask (scorecard module: won and stage 6–7 opportunities) | sync app, read-only, as Pipeline shows them (changed 10 Nov 2026); weighted pipeline is a current-week reading; on trial from 0.6.5 |
| New seats, seats serviced (4–5) | Autotask (scorecard module: contracts, won opportunities' quotes) | sync app, read-only; seat = units of the three seat services; on trial from 0.5.4 |
| SLA, tickets/tech/day, FCR, utilisation (6–9) | Autotask (scorecard module) | sync app, read-only; techs = default department Service Desk (D16); on trial from 0.5.3 |
| CSAT, NPS (10–11) | SimpleSAT | API key, read-only (`POST /api/v1/answers/search`); on trial from 0.6.5 |
| Cash, DSO, SGM, EBITDA % (12–15) | Live Xero, read-only (D17) | standard OAuth, granular `.read` scopes, SLI reporting codes |

### Integrations (D7, D10, D11, D16, D17)
- **Microsoft Graph** via managed identity (no secrets): users and aliases for the People directory, Planner for To-dos, mail for the weekly summary (one sender mailbox, limited by an Exchange application access policy).
- **People directory:** nightly and at first sign-in, matching every Entra address against active Autotask resources, with a *Needs review* list.
- **Autotask departments (D16):** department membership synced every 15 minutes and on demand; view by department; change default department for one or many people (Platform Admins and Leadership), written to `ResourceRoleDepartments` and audited.
- **Xero (D17):** a Finance user connects once from the Connections page; refresh token in Key Vault, renewed hourly.
- **Planner:** To-dos ↔ "Pulse – L10" plan, polled every 5 minutes with ETags; last write wins; both sides audited.
- **Issue → Autotask ticket or project task:** one click, linked back.
- **Connections page:** status, last success, owner, expiry, rotation due; secrets write-only.

### Client health (D23)
- Sync app job "clients", nightly at 18:40 UTC and on request: recurring contracts in force (the Scorecard's read-only contract reader, `contracts.byCompany`) → clients with MRR, seats and soonest contract end; company owner → Account Manager; SimpleSAT `POST /responses/search` for 400 days → one row per CSAT or NPS rating (`client_feedback`), matched to the client by Autotask ticket number, contact id, then company name; Autotask tickets created in 90 days or still open → ticket signals.
- Score and reasons from `clients/model.js` (pure, tested) into `client`; a weekly snapshot in `client_week` for the trend; follow-ups in `client_note`; Issues raised from a client carry `source_kind` "client".
- Autotask module `clients`: read Companies, Tickets, Contacts, Resources; no writes.
- Alerts: the clients job calls `notify.clientAlerts` for clients that just moved into At risk (Activity feed, `nudge_log` kind "client-risk").

### Teams (D12)
- One Teams app package: personal app plus a configurable tab for the leadership channel, with Teams SSO (extra Application ID URI and Teams pre-authorised as a client: a setup-script step).
- ~~**Bot:** Azure Bot (free channel tier) running as a user-assigned managed identity.~~ **Changed 11 Nov 2026:** reminders go to the Teams Activity feed (Graph `sendActivityNotification`, application permission `TeamsActivity.Send` on the sync identity), sent by the sync app's "nudges" job every 15 minutes, each once (`nudge_log`). No bot resource or Bot Framework.
- **Email:** the Monday summary from one shared mailbox; Exchange Online RBAC for Applications gives the sync identity "Application Mail.Send" on that mailbox only (`setup/pulse-mail.ps1`).
- **Framing:** Pulse's CSP `frame-ancestors` allows only Teams and Microsoft 365 hosts; inside Teams the front end uses `getAuthToken()` (same v2 token as MSAL gives).
- Tested in the HD IT Testing Tenancy (Business Premium) with a test leadership team, then the real leadership channel in production.

### Front end
- Vanilla JavaScript, no framework and no bundler, matching the three apps. ES modules (`shell`, `scorecard`, `rocks`, `issues`, `todos`, `l10`, `vto`, `chart`, `people`, `admin`, `help`). `build.mjs` only fills in settings.
- HD IT Brand System V5.0. Every number has an ⓘ panel from `measurable_definition`.
- Help centre: user guide, FAQ, metric glossary, what's new, versioned and exportable to PDF later.

### The three apps (D9)
Brand V5 restyle; header hidden when framed by Pulse; `pulse:navigate` and `pulse:context` bridge messages; help moved into Pulse; the `/api/pulse/measures` route (Marketing ROI from 0.7.0). Backends and Table Storage unchanged; from 10 Nov 2026 the apps sign in to Autotask with Pulse's single API user (`AUTOTASK_SHARED_SECRET_URI`), their own credentials kept as a fallback.

## 3. Environments and cost
Test: HD IT Testing Tenancy, Australia East (SWA content from East Asia), deploy on every push to `main`. Production deploys only from an approved GitHub release. Test estimate A$20–35/month; production within D14's ~A$90–140 with Defender. Confirm in the Azure pricing calculator before production.

## 4. Build plan (each milestone ships to test)

| # | Milestone | Contents | Version |
|---|---|---|---|
| M0 | Foundations | Bicep for SQL, Key Vault, both Function Apps; setup-script `release1` step; migrations in the workflow; shared libs (auth, SQL, audit, Sydney week); `/api/me`; Brand V5 shell; audit log | 0.4.0 |
| M1 | EOS core | Accountability Chart and seats, V/TO, Rocks, Issues, To-dos, Scorecard with manual measurables, overrides, lock, history | 0.5.0 |
| M2 | Automatic Scorecard and people | Connections page credential entry (shipped early in 0.5.1); People directory and matching, Autotask departments view and two-way changes (0.5.2); collectors for Autotask (service measurables on trial in 0.5.3), seats and MRR, SimpleSAT, Xero; `/api/pulse/measures` in the three apps; metric ⓘ panels | 0.6.0 |
| MP | Projects (D21) | Programme and project Gantt (0.6.0); time entry, complete, drag with dependencies (0.6.1); resource planner, lead time, what-if (0.6.2) | 0.6.0–0.6.2 |
| M2b | Rest of M2 | Xero (0.6.4); SimpleSAT, MQLs from Marketing ROI's `/api/pulse/measures`, new MRR and weighted pipeline from Autotask, the apps on Pulse's Autotask user (0.6.5) | 0.6.4–0.6.5 |
| M3 | L10 meeting | Segue, Scorecard, Rock review, headlines, To-dos, IDS, conclude and rate; suggested Issues. Built 10 Nov 2026: `meeting`, `meeting_attendee`, `headline` tables; the page polls the meeting state every 4 seconds (no websockets needed); summary kept when it ends | 0.7.0 |
| M4 | Two-way links | Planner sync, Issue → Autotask, Rocks linked to Planner or Autotask projects. Built 11 Nov 2026: "links" job every 5 minutes; per-field three-way merge for To-dos (Pulse wins a clash); `todo_planner`, `issue_link`, `rock_link`, `planner_plan` tables; Autotask `issues` module may only create tickets and project tasks | 0.8.0 |
| M5 | Teams | Teams app, SSO, tab, bot notifications, weekly email. Built 11 Nov 2026 with Activity feed reminders instead of a bot | 0.9.0 |
| D23 | Client health | Early Warning score with reasons, happiness leaderboards, client page with feedback, trend, notes and Raise an Issue; Teams alert on At risk. Built 12 Nov 2026: "clients" job nightly; `client`, `client_feedback`, `client_week`, `client_note` tables | 0.10.0 |
| M6 | Apps in Pulse | Brand V5 restyle, framed mode, deep links, help moved | — |
| M7 | Release readiness | Help centre, ISO technical documents, production workflow with approval, CA policy, Defender, pulse.hdit.com.au | 1.0.0 |

## 5. Decisions taken
**11 November 2026 (0.9.0):** Pulse in Teams; reminders in the Teams Activity feed rather than a bot chat; the Monday email from a new shared mailbox (D12 amended).

**11 November 2026 (0.8.0):** two-way links built (D11): Planner To-dos, Issue → Autotask, Rock progress.

**10 November 2026 (0.7.0):** the L10 meeting runs in Pulse (D22).

**10 November 2026:** the apps use Pulse's single Autotask API user (D9 amended); new MRR and weighted pipeline worked out by Pulse from Autotask as Pipeline shows them; MQLs from Marketing ROI; SimpleSAT CSAT and NPS. All on trial (0.6.5).

**9 November 2026:** one Autotask API user with in-app module allow-lists (D7 amended); apps under their division (D20); Projects module next (D21): Project Managers and Leadership reschedule, preview then save to Autotask, lead time from open projects only, capacity 7.6 h/day less holidays, leave and non-project share.

**31 October 2026:**
1. **Xero:** live organisation in test and production, read-only by scope, standard OAuth connection (D17).
2. **Teams and Planner:** tested in the Testing Tenancy, which has Business Premium licences.
3. **Tech:** any Autotask resource whose default department is Service Desk; Pulse shows people by department and changes default departments two-way (D16).
4. **Overrides:** leadership any measurable; staff their own division's.
