// Builds the deployable Pulse front end into dist/.
//
//   node scripts/build.mjs
//
// Settings come from environment variables (the deploy workflow sets them):
//   ENTRA_TENANT_ID   tenant of the HD IT Pulse app registration
//   ENTRA_CLIENT_ID   application (client) id of the HD IT Pulse app registration
//   ENV_LABEL         shown in the top bar, e.g. Test or Production
//   PULSE_API_URL     the Pulse API, e.g. https://func-hdit-pulse-api-test-aue.azurewebsites.net/api (empty = no server yet)
//   APP_PIPELINE_URL, APP_MROI_URL, APP_WSPACE_URL   each app's own site (https://host), empty = not set up here
//   PULSE_HOST        Pulse's own host name (e.g. ashy-sand-099e8e200.4.azurestaticapps.net), for the Teams app (0.9.0)
//   TEAMS_APP_ID      the Teams app's id for this environment (default: the test one)
//
// Missing tenant or client id = preview build (simulated sign-in).
// Also checks that every place the version is written agrees, so a release can't ship half-bumped.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";

const env = k => String(process.env[k] || "").trim();
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const die = m => { console.error(m); process.exit(1); };
const origin = k => {
  const v = env(k).replace(/\/+$/, "");
  if (v && !/^https:\/\/[a-z0-9.-]+$/i.test(v)) die(`${k} must look like https://host (got "${v}")`);
  return v;
};

const tenantId = env("ENTRA_TENANT_ID"), clientId = env("ENTRA_CLIENT_ID");
for (const [k, v] of [["ENTRA_TENANT_ID", tenantId], ["ENTRA_CLIENT_ID", clientId]]) if (v && !guid.test(v)) die(`${k} must be a GUID`);
const apiUrl = env("PULSE_API_URL").replace(/\/+$/, "");
if (apiUrl && !/^https:\/\/[a-z0-9.-]+\/api$/i.test(apiUrl)) die(`PULSE_API_URL must look like https://host/api (got "${apiUrl}")`);
const apps = { pipeline: origin("APP_PIPELINE_URL"), mroi: origin("APP_MROI_URL"), wspace: origin("APP_WSPACE_URL") };
const label = env("ENV_LABEL") || "Test";

/* ---- one version everywhere ---- */
const read = p => readFileSync(p, "utf8");
const versions = {
  "frontend/js/config.js": (read("frontend/js/config.js").match(/APP_VERSION: "([0-9.]+)"/) || [])[1],
  "frontend/index.html": (read("frontend/index.html").match(/APP_VERSION: "([0-9.]+)"/) || [])[1],
  "frontend/user-guide.html": (read("frontend/user-guide.html").match(/data-built-for="([0-9.]+)"/) || [])[1],
  "frontend/changelog.html": (read("frontend/changelog.html").match(/data-built-for="([0-9.]+)"/) || [])[1],
  "backend/package.json": JSON.parse(read("backend/package.json")).version,
  "CHANGELOG.md": (read("CHANGELOG.md").match(/^## ([0-9.]+)/m) || [])[1],
};
const want = versions["frontend/js/config.js"];
const off = Object.entries(versions).filter(([, v]) => v !== want);
if (!want || off.length) die(`Version mismatch (expected ${want}):\n` + off.map(([f, v]) => `  ${f}: ${v || "missing"}`).join("\n"));

/* ---- copy frontend/ to dist/ ---- */
rmSync("dist", { recursive: true, force: true });
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    const s = join(src, f), d = join(dst, f);
    if (statSync(s).isDirectory()) copyDir(s, d); else { mkdirSync(dirname(d), { recursive: true }); copyFileSync(s, d); }
  }
}
copyDir("frontend", "dist");

writeFileSync("dist/js/config.js", read("frontend/js/config.js")
  .replaceAll("__TENANT_ID__", tenantId || "__TENANT_ID__")
  .replaceAll("__CLIENT_ID__", clientId || "__CLIENT_ID__")
  .replaceAll("__ENVIRONMENT__", label)
  .replaceAll("__API_BASE__", apiUrl || "__API_BASE__")
  .replaceAll("__APP_PIPELINE__", apps.pipeline || "__APP_PIPELINE__")
  .replaceAll("__APP_MROI__", apps.mroi || "__APP_MROI__")
  .replaceAll("__APP_WSPACE__", apps.wspace || "__APP_WSPACE__"));

// Pulse may frame only the apps it knows about, and call only its own API, at their exact addresses.
const frames = Object.values(apps).filter(Boolean);
const apiOrigin = apiUrl ? new URL(apiUrl).origin : "";
writeFileSync("dist/staticwebapp.config.json", read("frontend/staticwebapp.config.json")
  .replaceAll("__FRAME_SRC__", frames.length ? frames.join(" ") : "'none'")
  .replaceAll("__API_ORIGIN__", apiOrigin));

/* ---- the Teams app (0.9.0): manifest for this environment; the workflow zips it with the icons ---- */
const host = env("PULSE_HOST").replace(/^https:\/\//, "").replace(/\/+$/, "");
const teamsAppId = env("TEAMS_APP_ID") || "d46a6617-9686-4ea3-9801-785e42e3a1db";
if (host && !/^[a-z0-9.-]+$/i.test(host)) die(`PULSE_HOST must be a host name (got "${host}")`);
if (host && clientId) {
  const prod = /^prod/i.test(label), suffix = prod ? "" : ` (${label})`;
  const page = (id, name, hash) => ({ entityId: id, name, contentUrl: `https://${host}/?teams=1#/${hash}`, websiteUrl: `https://${host}/#/${hash}`, scopes: ["personal"] });
  const manifest = {
    $schema: "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17", version: want, id: teamsAppId,
    developer: { name: "HD IT", websiteUrl: "https://www.hdit.com.au", privacyUrl: "https://www.hdit.com.au", termsOfUseUrl: "https://www.hdit.com.au" },
    name: { short: `Pulse${suffix}`.slice(0, 30), full: `HD IT Pulse${suffix}` },
    description: { short: "HD IT's Scorecard, Rocks, Issues, To-dos and L10 meeting.",
      full: "HD IT Pulse runs HD IT on EOS: the weekly Scorecard filled in from Autotask, Xero and SimpleSAT, quarterly Rocks, the Issues List, To-dos and the Tuesday L10 meeting, with each division's numbers and tools. For HD IT staff only; you see what your Pulse groups allow." },
    icons: { color: "color.png", outline: "outline.png" }, accentColor: "#101B3C",
    staticTabs: [page("home", "Pulse", ""), page("l10", "L10", "l10"), page("todos", "To-dos", "todos")],
    configurableTabs: [{ configurationUrl: `https://${host}/teams-config.html?teams=1`, canUpdateConfiguration: true, scopes: ["team", "groupChat"],
      context: ["channelTab", "privateChatTab", "meetingChatTab", "meetingDetailsTab", "meetingSidePanel"] }],
    permissions: ["identity"], validDomains: [host],
    webApplicationInfo: { id: clientId, resource: `api://${host}/${clientId}` },
    activities: { activityTypes: [{ type: "pulseReminder", description: "A Pulse reminder", templateText: "{text}" }] },
  };
  mkdirSync("dist/teams", { recursive: true });
  writeFileSync("dist/teams/manifest.json", JSON.stringify(manifest, null, 2));
}

const mode = tenantId && clientId ? `Entra ID sign-in (client ${clientId})` : "PREVIEW (no Entra ID settings)";
console.log(`Built dist/ v${want} for ${label}: ${mode}; API ${apiUrl || "— (shell only)"}; apps: ${Object.entries(apps).map(([k, v]) => `${k}=${v || "—"}`).join(", ")}; Teams app: ${host && clientId ? teamsAppId : "—"}`);
