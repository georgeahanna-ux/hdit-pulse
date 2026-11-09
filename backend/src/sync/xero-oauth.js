"use strict";
/**
 * "Connect to Xero" (D17), on the sync app (the only part of Pulse that can read the Xero app's
 * secret and write the refresh token). Both routes are reached by the browser, so neither trusts
 * anything but the one-time state Pulse's API created for a signed-in Platform Admin or Finance
 * user in the last 10 minutes.
 *
 *   GET /api/xero/authorize?state=…   → Xero's sign-in and consent page
 *   GET /api/xero/callback?code&state → tokens saved, back to Pulse's Connections page
 */
const db = require("../lib/sql");
const audit = require("../lib/audit");
const xero = require("../lib/xero");

const pulse = (q = "") => `${String(process.env.PULSE_ORIGIN || "").replace(/\/+$/, "")}/#/connections${q}`;
const redirect = to => ({ status: 302, headers: { location: to, "cache-control": "no-store" } });
const okState = s => /^[A-Za-z0-9_-]{32,64}$/.test(String(s || ""));

async function loadState(state, { use }) {
  if (!okState(state)) return null;
  const [row] = await db.query(
    `${use ? "UPDATE pulse.xero_oauth_state SET used_at = SYSUTCDATETIME() OUTPUT inserted.person_oid, inserted.person_name" : "SELECT person_oid, person_name FROM pulse.xero_oauth_state"}
      WHERE state = @state AND used_at IS NULL AND created_at > DATEADD(minute, -10, SYSUTCDATETIME())`, { state });
  return row || null;
}

async function authorize(request) {
  const state = request.query.get("state");
  if (!(await loadState(state, { use: false }))) return redirect(pulse("?xero=expired"));
  const c = await xero.appCreds().catch(() => null);
  if (!c) return redirect(pulse("?xero=no-app"));
  return redirect(xero.authorizeUrl(c.clientId, state));
}

async function callback(request, context) {
  const state = request.query.get("state");
  const who = await loadState(state, { use: true });
  if (!who) return redirect(pulse("?xero=expired"));
  if (request.query.get("error")) return redirect(pulse("?xero=declined"));
  try {
    const tenant = await xero.connect(request.query.get("code"), who.person_name);
    await db.query("UPDATE pulse.connection_status SET configured = 1, last_error = NULL, secret_updated_at = SYSUTCDATETIME(), last_checked_at = SYSUTCDATETIME() WHERE name = N'xero-token'");
    await audit.record({ actor: { oid: who.person_oid, name: who.person_name }, action: "connection.xero.connect", entity: { type: "connection", id: "xero-token" },
      after: { organisation: tenant.tenantName, scopes: xero.SCOPES }, request }, context);
    return redirect(pulse("?xero=connected"));
  } catch (e) {
    context.error("Xero connect failed", e.message);
    return redirect(pulse(`?xero=failed&why=${encodeURIComponent(String(e.message).slice(0, 160))}`));
  }
}

module.exports = { authorize, callback };
