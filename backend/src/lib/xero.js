"use strict";
/**
 * Xero (D17): live organisation, read-only, standard OAuth 2.0 web app. Runs in the sync app only:
 * it is the only part of Pulse that can read "xero-app" (client id and secret) and read and
 * write "xero-token" (the refresh token, which Xero replaces on every use).
 *
 * Scopes are read-only and granular (apps created after 2 March 2026 accept only these):
 * profit and loss, balance sheet, bank summary, chart of accounts (settings), plus offline_access.
 */
const vault = require("./vault");
const db = require("./sql");

const SCOPES = [
  "offline_access",
  "accounting.reports.profitandloss.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.banksummary.read",
  "accounting.settings.read",
];
const AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const API = "https://api.xero.com";

let fetchImpl = (...a) => fetch(...a);
const redirectUri = () => `${(process.env.PULSE_SYNC_URL || `https://${process.env.WEBSITE_HOSTNAME}`).replace(/\/+$/, "")}/api/xero/callback`;

function fail(message, code) { const e = new Error(message); e.code = code; return e; }

async function appCreds() {
  const s = await vault.getSecret("xero-app");
  if (!s || !s.value) throw fail("The Xero app's client id and secret haven't been entered yet (Connections → Xero app).", "not-connected");
  let c; try { c = JSON.parse(s.value); } catch { throw fail("The Xero app details are in an old format. Enter them again under Connections."); }
  if (!c.clientId || !c.clientSecret) throw fail("The Xero app details are incomplete. Enter them again under Connections.");
  return c;
}

function authorizeUrl(clientId, state) {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri(), scope: SCOPES.join(" "), state });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(c, form) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(body.error === "invalid_grant"
    ? "Xero's connection has expired or been removed. Select Connect to Xero on the Connections page again."
    : `Xero sign-in failed (${res.status} ${body.error || ""}).`, body.error === "invalid_grant" ? "reconnect" : "xero");
  return body;
}

/** Saves the token set: refresh token and organisation in Key Vault, organisation name in settings (not secret). */
async function saveToken(t, tenant, by) {
  await vault.setSecret("xero-token", JSON.stringify({ refreshToken: t.refresh_token, tenantId: tenant.tenantId, tenantName: tenant.tenantName, savedAt: new Date().toISOString() }));
  for (const [key, value] of [["xero.tenant_name", tenant.tenantName], ["xero.connected_by", by || null]]) {
    if (value === null && key === "xero.connected_by") continue;
    await db.query(`MERGE pulse.app_setting AS t USING (SELECT @key AS [key]) AS s ON t.[key] = s.[key]
      WHEN MATCHED THEN UPDATE SET [value] = @value, updated_by = N'Xero connection'
      WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (@key, @value, N'Xero connection');`, { key, value });
  }
}

/** Callback: code → tokens → the organisation(s) this connection can see. */
async function connect(code, by) {
  const c = await appCreds();
  const t = await tokenRequest(c, { grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  const res = await fetchImpl(`${API}/connections`, { headers: { authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(30000) });
  const tenants = ((await res.json().catch(() => [])) || []).filter(x => x.tenantType === "ORGANISATION");
  if (!tenants.length) throw fail("Xero connected, but no organisation was chosen. Connect again and tick HD IT's organisation.");
  const tenant = tenants.find(x => /hd\s*it/i.test(x.tenantName)) || tenants[0];
  await saveToken(t, tenant, by);
  return tenant;
}

/**
 * A session for one run: renews the access token (and saves the new refresh token at once,
 * because Xero's refresh tokens work only once), then makes read-only GET calls.
 */
async function session() {
  const s = await vault.getSecret("xero-token");
  if (!s || !s.value) throw fail("Xero isn't connected yet. Select Connect to Xero on the Connections page.", "not-connected");
  const saved = JSON.parse(s.value);
  const c = await appCreds();
  const t = await tokenRequest(c, { grant_type: "refresh_token", refresh_token: saved.refreshToken });
  await saveToken(t, { tenantId: saved.tenantId, tenantName: saved.tenantName }, null);
  let last = 0;
  const get = async (path, params = {}) => {
    const wait = 1100 - (Date.now() - last);   // Xero allows 60 calls a minute per organisation
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const url = `${API}/api.xro/2.0/${path}${Object.keys(params).length ? "?" + new URLSearchParams(params) : ""}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetchImpl(url, { headers: { authorization: `Bearer ${t.access_token}`, "xero-tenant-id": saved.tenantId, accept: "application/json" }, signal: AbortSignal.timeout(60000) });
      if (res.status === 429) { await new Promise(r => setTimeout(r, Number(res.headers.get("retry-after") || 5) * 1000)); continue; }
      if (!res.ok) throw fail(`Xero ${path} answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status === 403 ? "forbidden" : "xero");
      return res.json();
    }
    throw fail("Xero is busy (rate limit). The next hourly run will try again.");
  };
  return { get, tenantName: saved.tenantName };
}

module.exports = { SCOPES, appCreds, authorizeUrl, connect, session, redirectUri, _test: { setFetch(f) { fetchImpl = f; } } };
