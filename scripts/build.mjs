// Builds the deployable Pulse front end into dist/.
//
//   node scripts/build.mjs
//
// Settings come from environment variables (the deploy workflow sets them):
//   ENTRA_TENANT_ID   tenant of the HD IT Pulse app registration
//   ENTRA_CLIENT_ID   application (client) id of the HD IT Pulse app registration
//   ENV_LABEL         shown in the top bar, e.g. Test or Production
//   APP_PIPELINE_URL, APP_MROI_URL, APP_WSPACE_URL   each app's own site (https://host), empty = "moving into Pulse"
//
// Missing tenant or client id = preview build (simulated sign-in), which is what the Claude prototype shows.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync } from "node:fs";

const env = k => String(process.env[k] || "").trim();
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const origin = (k) => {
  const v = env(k).replace(/\/+$/, "");
  if (!v) return "";
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(v)) { console.error(`${k} must look like https://host (got "${v}")`); process.exit(1); }
  return v;
};

const tenantId = env("ENTRA_TENANT_ID"), clientId = env("ENTRA_CLIENT_ID");
for (const [k, v] of [["ENTRA_TENANT_ID", tenantId], ["ENTRA_CLIENT_ID", clientId]]) {
  if (v && !guid.test(v)) { console.error(`${k} must be a GUID`); process.exit(1); }
}
const apps = { pipeline: origin("APP_PIPELINE_URL"), mroi: origin("APP_MROI_URL"), wspace: origin("APP_WSPACE_URL") };
const label = env("ENV_LABEL") || "Test";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/vendor", { recursive: true });

let index = readFileSync("frontend/index.html", "utf8")
  .replaceAll("__TENANT_ID__", tenantId || "__TENANT_ID__")
  .replaceAll("__CLIENT_ID__", clientId || "__CLIENT_ID__")
  .replaceAll("__ENVIRONMENT__", label)
  .replaceAll("__APP_PIPELINE__", apps.pipeline)
  .replaceAll("__APP_MROI__", apps.mroi)
  .replaceAll("__APP_WSPACE__", apps.wspace);
writeFileSync("dist/index.html", index);

for (const f of ["user-guide.html", "changelog.html"]) copyFileSync(`frontend/${f}`, `dist/${f}`);
for (const f of readdirSync("frontend/vendor")) copyFileSync(`frontend/vendor/${f}`, `dist/vendor/${f}`);

// Pulse may frame only the apps it knows about, at their exact addresses.
const frames = Object.values(apps).filter(Boolean);
writeFileSync("dist/staticwebapp.config.json",
  readFileSync("frontend/staticwebapp.config.json", "utf8").replaceAll("__FRAME_SRC__", frames.length ? frames.join(" ") : "'none'"));

const mode = tenantId && clientId ? `Entra ID sign-in (client ${clientId})` : "PREVIEW (no Entra ID settings)";
console.log(`Built dist/ for ${label}: ${mode}; apps: ${Object.entries(apps).map(([k, v]) => `${k}=${v || "—"}`).join(", ")}`);
