# HD IT Pulse

The single front door to HD IT's internal apps: one Microsoft 365 sign-in (Entra ID), and each person sees only the apps they're authorised for. Dashboards for each division appear greyed out as **Coming soon** and switch on one at a time.

| Live in Pulse | Repository | Role prefix |
|---|---|---|
| Pipeline | `georgeahanna-ux/hdit-pipeline` | `Pipeline` |
| Marketing ROI | `georgeahanna-ux/marketing-roi` | `MarketingROI` |
| Whitespace Matrix | `georgeahanna-ux/sales-whitespace` | `Whitespace` |

Each app keeps its own backend, Key Vault and Autotask API user, and runs inside Pulse in an iframe that Pulse signs in. See **[docs/IDENTITY-AND-ACCESS.md](docs/IDENTITY-AND-ACCESS.md)** for the design and the setup steps.

## Layout

```
frontend/index.html             Pulse (one page, vanilla JS). Preview mode when no Entra client id is set.
frontend/vendor/                MSAL for the browser (@azure/msal-browser 4.30.0, MIT)
frontend/staticwebapp.config.json  security headers; frame-src is limited to the apps' addresses
scripts/build.mjs               fills in tenant, client id and app addresses → dist/
infra/main.bicep                the Static Web App
setup/pulse-setup.sh            one-off Azure + Entra ID setup (Cloud Shell)
.github/workflows/deploy-test.yml  build and deploy to the test tenancy on every push to main
```

## Build locally

```bash
node scripts/build.mjs                       # preview build (simulated sign-in)
ENTRA_TENANT_ID=… ENTRA_CLIENT_ID=… APP_WSPACE_URL=https://… node scripts/build.mjs
```

Version: `CONFIG.APP_VERSION` in `frontend/index.html`, with `BUILT_FOR` in the user guide and change log and an entry in `CHANGELOG.md`.
