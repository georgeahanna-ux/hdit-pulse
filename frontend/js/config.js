// Filled in by scripts/build.mjs at deploy time. Placeholders left as-is mean "not set":
// no tenant or client id = preview (simulated sign-in); no API address = shell only (no server yet).
export const DEPLOY = {
  tenantId: "__TENANT_ID__",
  clientId: "__CLIENT_ID__",
  environment: "__ENVIRONMENT__",
  apiBase: "__API_BASE__",
  apps: { pipeline: "__APP_PIPELINE__", mroi: "__APP_MROI__", wspace: "__APP_WSPACE__" },
};

const filled = v => !!v && !String(v).startsWith("__");

export const CONFIG = {
  APP_VERSION: "0.7.1",
  PREVIEW: !filled(DEPLOY.clientId) || !filled(DEPLOY.tenantId),
  ENVIRONMENT: filled(DEPLOY.environment) ? DEPLOY.environment : "Preview",
  API_BASE: filled(DEPLOY.apiBase) ? String(DEPLOY.apiBase).replace(/\/+$/, "") : "",
  API_SCOPE: `api://${DEPLOY.clientId}/access_as_user`,
  APP_URLS: Object.fromEntries(Object.entries(DEPLOY.apps).map(([k, v]) => [k, filled(v) ? String(v).replace(/\/+$/, "") : ""])),
};
