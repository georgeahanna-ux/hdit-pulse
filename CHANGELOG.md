# Changelog

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
