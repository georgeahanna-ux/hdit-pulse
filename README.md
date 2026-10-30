# HD IT Pulse

HD IT's EOS system and the front door to its internal apps: Scorecard, Rocks, Issues, To-dos, the L10, V/TO and the Accountability Chart, with one Microsoft 365 sign-in (Entra ID). Each person sees only what their Pulse groups allow. Release 1 is being built in milestones; see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** and **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)**.

| Live in Pulse | Repository | Role prefix |
|---|---|---|
| Pipeline | `georgeahanna-ux/hdit-pipeline` | `Pipeline` |
| Marketing ROI | `georgeahanna-ux/marketing-roi` | `MarketingROI` |
| Whitespace Matrix | `georgeahanna-ux/sales-whitespace` | `Whitespace` |

Each app keeps its own backend, Key Vault and Autotask API user, and runs inside Pulse in an iframe that Pulse signs in. See **[docs/IDENTITY-AND-ACCESS.md](docs/IDENTITY-AND-ACCESS.md)** for the design and the setup steps.

## Layout

```
frontend/                      Pulse web (vanilla JS ES modules, Brand V5). Preview mode when no Entra client id is set.
  js/                          main (shell, routing), auth (MSAL), api, apps (token bridge), views, access
  brand/                       official HD IT Brand V5 assets (logo, icons, tokens, pattern)
  vendor/                      MSAL for the browser (@azure/msal-browser 4.30.0, MIT)
backend/                       one package, two Function Apps (PULSE_COMPONENT=api | sync), Node 22
  src/lib/                     entra (token checks), access (who can do what), time (Sydney weeks, lock), sql, audit, vault
  scripts/migrate.js           applies db/migrations in order (run by GitHub Actions)
db/migrations/                 numbered SQL migrations (never edit one that has run)
scripts/build.mjs              fills in settings, checks versions agree → dist/
infra/main.bicep               Static Web App, Azure SQL, Key Vault, storage, monitoring, both Function Apps
setup/pulse-setup.sh           one-off Azure + Entra ID setup (Cloud Shell): azure, entra, release1, release1-entra
docs/                          REQUIREMENTS (D1–D17), ARCHITECTURE (release 1 plan), IDENTITY-AND-ACCESS
.github/workflows/deploy-test.yml  test, migrate and deploy to the test tenancy on every push to main
```

## Build locally

```bash
node scripts/build.mjs                       # preview build (simulated sign-in)
PULSE_API_URL=https://func-hdit-pulse-api-test-aue.azurewebsites.net/api …  # with the API
ENTRA_TENANT_ID=… ENTRA_CLIENT_ID=… APP_WSPACE_URL=https://… node scripts/build.mjs
```

Version: `CONFIG.APP_VERSION` in `frontend/js/config.js`. The build stops unless `frontend/index.html`, the help pages' `data-built-for`, `backend/package.json` and the top of `CHANGELOG.md` all agree.

Backend tests: `cd backend && npm test`.
