"use strict";
/**
 * Scorecard numbers from the apps inside Pulse (D9). The sync service calls each app's
 * GET /api/pulse/measures with an app-only token for the HD IT Pulse app registration, carrying
 * the Pulse.Collector role (its managed identity; no secrets). The app checks the token itself.
 *
 *   Marketing ROI (APP_MROI_API): MQLs, as opportunity ids and when each first reached MQL.
 */
const { DefaultAzureCredential } = require("@azure/identity");

const APIS = { mroi: () => process.env.APP_MROI_API, };
const NAMES = { mroi: "Marketing ROI" };
let credential = null;
const cred = () => (credential = credential || new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID || undefined }));
let fetchImpl = (...a) => fetch(...a);
let tokenImpl = async () => (await cred().getToken(`api://${String(process.env.ENTRA_CLIENT_ID || "").trim()}/.default`)).token;

function fail(message, code) { const e = new Error(message); if (code) e.code = code; return e; }

async function measures(app) {
  const base = String((APIS[app] || (() => ""))() || "").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(\/[\w/-]*)?$/i.test(base)) throw fail(`${NAMES[app] || app}'s address isn't set (APP_${app.toUpperCase()}_API).`, "not-connected");
  if (!process.env.ENTRA_CLIENT_ID) throw fail("ENTRA_CLIENT_ID isn't set, so Pulse can't sign in to its apps.");
  const token = await tokenImpl();
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetchImpl(`${base}/pulse/measures`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(120000) });
    if (res.status !== 503 && res.status !== 429 && res.status !== 502) break;
    await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw fail(`${NAMES[app]} refused Pulse's sign-in (${body.message || res.status}). Check that the sync identity has Pulse.Collector (pulse-setup.sh release1-entra) and ${NAMES[app]} runs 0.7.0 or later.`);
  if (res.status === 404) throw fail(`${NAMES[app]} doesn't have the Pulse measures endpoint yet (needs 0.7.0 or later).`);
  if (!res.ok) throw fail(`${NAMES[app]} answered ${res.status}: ${body.message || "no detail"}`.slice(0, 300));
  return body;
}

module.exports = { measures, _test: { setFetch(f) { fetchImpl = f; }, setToken(f) { tokenImpl = f; } } };
