# Changelog

## 0.5.2 — 3 November 2026
Milestone M2, part 1: People directory (D10) and Autotask departments (D16).
- **People and departments** page (Platform → People and departments) for Leadership and Platform Admins, with three tabs:
  - **Directory:** everyone in Pulse with their linked Autotask resource, default department, and when they last used Pulse. Platform Admins can change a link, mark that someone has no Autotask account, or go back to automatic matching (each needs a reason and is audited).
  - **Autotask departments:** who has each default department, with Service Desk marked as "Techs for the Scorecard". Leadership and Platform Admins tick one or more people and change their default department; Pulse writes it to Autotask straight away (`ResourceRoleDepartments`), adding the person to the department with their current role (or a chosen role) if needed, then re-reads them to confirm.
  - **Needs review:** people with no Autotask match, more than one match or a conflicting link, plus Autotask accounts not linked to anyone.
- Sync service: Autotask departments, roles, resources and department pairings every 15 minutes; Entra users (licensed, enabled, members only) daily; on-demand refresh from the page. Matching by any Autotask email (primary, second or third) against any Entra address; links set by an admin always win.
- Migration `0005_people_directory`: Entra fields on `person`, Autotask departments, roles, resources and pairings (temporal), `person_link` (temporal) and `person_link_none`, `directory_review`, `sync_request`.
- Needs the **Autotask: People administration** credential on the Connections page; Entra uses the sync service's managed identity.
- 13 new tests (72 in total).

## 0.5.1 — 3 November 2026
Connections page: credential entry moved forward from 1.0 (decided 3 Nov 2026).
- Platform Admins enter, replace and remove each integration credential in Pulse. Values go straight to Key Vault through the API's write-only role ("Pulse Secret Writer"); they are never stored in SQL, logged, or returned to the browser, and can't be shown again.
- Autotask credentials are tested before saving (zone lookup, then a signed-in call); the REST address found is saved with them.
- Replacing or removing a credential needs a reason. Owner and rotation-due date per connection; "Rotation overdue" flag. Every change audited with field names only.
- Migration `0004_connection_details` (who last changed each credential).
- `backend/src/lib/credentials.js` defines every connection, its fields and the permissions its API user needs. 5 new tests (59 in total), including that no credential value reaches SQL or the audit log.

## 0.5.0 — 3 November 2026
Milestone M1: EOS core, navigation by division and role (D18), FY progress bars (D19).
- Migration `0003_accountability_chart`: 23 seats with roles, key results, reporting lines and holders (job title and team) from the Accountability Chart (19 Aug 2026) and Org Chart (21 Aug 2026); functions reworked to match; division key results; each seat's apps; company measurables linked to their division's head seat.
- Front end: Home (My Pulse) with your seat, To-dos, Rocks and measurables, plus FY27 progress bars for Leadership and Finance; Company section (Scorecard grid with enter / override / revert dialogs and definitions, Rocks with milestones, Issues with top-three priorities, To-dos, V/TO, Accountability Chart editor, FY plan with quarter targets and month-end entry); division pages with tabs; seat (role) pages with holders by team, owned measurables, Rocks, apps and a proposed role scorecard.
- API: seat holders carry job title and team; seats carry apps; seat holders and measurable owners match the signed-in person by email, or by name while emails are unknown (display only; permissions come from Entra groups).
- Preview mode has a simulated API for every page.
- 54 backend tests.

## 0.4.3 — 3 November 2026
Milestone M1, part 1: database and API (pages follow in 0.5.0).
- Migration `0002_eos_core`: divisions and functions (D3), seats and seat holders (Accountability Chart), measurables (the 15 from D4, manual until M2), weekly Scorecard values with entered / automatic / override values, Rocks and milestones, Issues, To-dos, V/TO sections, annual plan (FY27 targets from the V/TO; quarter targets by hand; month-end actuals). All edited tables temporal.
- API: `/structure`, `/seats`, `/me/summary`, `/scorecard` (enter, override, revert), `/measurables`, `/rocks`, `/issues`, `/todos`, `/vto`, `/plan`. Every change audited; overrides and changes to existing month-end figures need a reason.
- Financial-year helpers (FY27 = Jul 2026–Jun 2027) and annual plan progress maths (cumulative and level metrics, quarter sub-bars, time elapsed).
- 21 new tests (53 in total).

## 0.4.2 — 3 November 2026
- Pulse backend switched on in test: database, API and sync service deployed; migration 0001 applied.
- API `/health` reports the last sync run, so a deploy can confirm the sync service is working.
- Deploy smoke test retries the sync service health check and reports its HTTP status.

## 0.4.1 — 31 October 2026
- Sign-in page: HD IT logo and "Keep IT Moving" tagline aligned left, as designed.

## 0.4.0 — 31 October 2026
Release 1, milestone M0 (foundations). See `docs/ARCHITECTURE.md`.
- **Backend:** one package (`backend/`) deployed as two Function Apps: `func-hdit-pulse-api` (user-facing API) and `func-hdit-pulse-sync` (timers, integrations). Each runs as its own managed identity.
- **Database:** Azure SQL (Basic in test), Entra-only sign-in. Migration `0001_foundations`: people, append-only audit trail, sync runs, connection status, settings; temporal history on edited tables. Migrations run from GitHub Actions (`backend/scripts/migrate.js`).
- **Key Vault:** one placeholder per integration credential, readable only by the component that needs it (secret-level RBAC). API identity is write-only via the custom "Pulse Secret Writer" role.
- **API:** `/health`, `/me` (records the sign-in), `/calendar/week`, `/audit`, `/audit/view`, `/connections`. Entra tokens checked on every request; access from app roles (`backend/src/lib/access.js`), including the override rule (leadership any measurable, staff own division).
- **Sync:** hourly check of which credentials have been entered (never stores values).
- **Scorecard calendar:** Monday–Sunday Sydney weeks, lock 5pm Tuesday after, daylight saving handled (`backend/src/lib/time.js`, tests).
- **Front end:** rebuilt in Brand V5 as ES modules (no inline scripts; CSP `script-src 'self'`). Audit log and Connections pages. Help pages rebranded.
- **Setup:** `pulse-setup.sh release1` (identities, Key Vault, secret access) and `release1-entra` (new roles and groups, SQL admin group, Pulse.Collector, Graph permissions for the sync identity).
- **Infra:** `infra/main.bicep` adds SQL, Key Vault, storage, monitoring and both Function Apps; deployed only once `sqlAdminGroupId` is set.

## 0.3.0 — 23 October 2026
- Pulse becomes the front door for HD IT apps: Microsoft 365 (Entra ID) sign-in with MSAL, no third-party cookies.
- Pipeline, Marketing ROI and Whitespace Matrix open inside Pulse and are signed in by it; each person sees only the apps their Entra groups allow.
- Access model: app roles on the HD IT Pulse app registration, assigned to "Pulse - …" security groups. "Your access" page.
- Division dashboards from the prototype shown as Coming soon.
- Setup script for the HD IT Testing Tenancy; GitHub Actions deploy to `rg-hdit-pulse-test-aue`.

## 0.2.0 — September 2026
- Clickable prototype on sample data with persona-based access.
