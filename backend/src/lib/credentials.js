"use strict";
/**
 * Integration credentials entered on the Connections page (D7). Write-only:
 *   - Platform Admins type a credential into Pulse; the API writes it straight to Key Vault.
 *   - The API's identity can set secrets and read their metadata but can never read a value back
 *     (custom role "Pulse Secret Writer"), so a credential can't be shown again, only replaced.
 *   - Only the sync service can read the credentials it uses (secret-level access).
 *   - Values are never logged, stored in SQL or returned to the browser; the audit log records
 *     who changed which credential, when and why, with field names only.
 *
 * Autotask credentials are tested before they're saved (zone lookup, then one signed-in call).
 */
const { fail } = require("./errors");

const AUTOTASK_FIELDS = [
  { key: "username", label: "API username", secret: false, required: true, hint: "The API user's username (key), e.g. abcd1234@HDIT.com" },
  { key: "secret", label: "API secret", secret: true, required: true },
  { key: "integrationCode", label: "Tracking identifier (integration code)", secret: true, required: true },
];

/** Every credential Pulse uses. Names match the Key Vault secrets created by pulse-setup.sh release1. */
const TYPES = {
  "autotask-service": { system: "Autotask", label: "Autotask: Service", kind: "autotask", fields: AUTOTASK_FIELDS,
    purpose: "Tickets, projects, time entries and resources for the Managed Services measurables; creates tickets from Issues.",
    permissions: "Read tickets, projects, time entries, resources, companies and holiday sets. Add tickets and project tasks." },
  "autotask-people": { system: "Autotask", label: "Autotask: People administration", kind: "autotask", fields: AUTOTASK_FIELDS,
    purpose: "Who's in each Autotask department, and changing default departments (D16).",
    permissions: "Read resources, roles and departments. Add and edit resource role departments." },
  "autotask-finance": { system: "Autotask", label: "Autotask: Finance", kind: "autotask", fields: AUTOTASK_FIELDS,
    purpose: "Contracts and seats for new seats signed, seats serviced and MRR.",
    permissions: "Read-only: contracts, contract services and billing items." },
  "simplesat": { system: "SimpleSAT", label: "SimpleSAT", kind: "fields",
    fields: [{ key: "apiKey", label: "API key", secret: true, required: true }],
    purpose: "CSAT and NPS.", permissions: "Read-only API key." },
  "xero-app": { system: "Xero", label: "Xero app", kind: "fields",
    fields: [{ key: "clientId", label: "Client id", secret: false, required: true }, { key: "clientSecret", label: "Client secret", secret: true, required: true }],
    purpose: "Cash, debtor days, services gross margin, EBITDA % and revenue (D17). Read-only scopes only.",
    permissions: "A Xero web app with read-only granular scopes. Connect it to HD IT's organisation with \"Connect to Xero\" (arrives in 0.6.0)." },
  "xero-token": { system: "Xero", label: "Xero connection", kind: "oauth",
    fields: [], purpose: "Xero's refresh token. Set by \"Connect to Xero\" and renewed automatically every hour.",
    permissions: "Not entered by hand." },
  "datto-rmm": { system: "Datto RMM", label: "Datto RMM", kind: "fields",
    fields: [
      { key: "apiUrl", label: "API address", secret: false, required: true, hint: "Your platform's API address, e.g. https://syrah-api.centrastage.net" },
      { key: "apiKey", label: "API key", secret: false, required: true },
      { key: "apiSecret", label: "API secret key", secret: true, required: true },
    ],
    purpose: "Device and patch data for the NOC (release 2).", permissions: "A read-only API user." },
  "itglue": { system: "IT Glue", label: "IT Glue", kind: "fields",
    fields: [
      { key: "apiUrl", label: "API address", secret: false, required: true, hint: "https://api.au.itglue.com for the Australian data centre, otherwise https://api.itglue.com" },
      { key: "apiKey", label: "API key", secret: true, required: true },
    ],
    purpose: "Documentation coverage (release 2).", permissions: "A read-only API key." },
};

/** Describes a credential for the browser: labels and field names only, never values. */
const describe = name => {
  const t = TYPES[name];
  return t && { name, system: t.system, label: t.label, kind: t.kind, purpose: t.purpose, permissions: t.permissions,
    fields: t.fields.map(f => ({ key: f.key, label: f.label, secret: f.secret, required: f.required, hint: f.hint || null })) };
};

/** Checks the submitted fields and returns the object to store. */
function validate(name, body) {
  const t = TYPES[name];
  if (!t) throw fail(404, "That connection doesn't exist.");
  if (t.kind === "oauth") throw fail(400, "This connection is set by connecting to the system, not by typing it in.");
  const out = {};
  for (const f of t.fields) {
    const v = String((body && body[f.key]) ?? "").trim();
    if (!v && f.required) throw fail(400, `${f.label} is required.`);
    if (v.length > 2000 || /[\r\n]/.test(v)) throw fail(400, `${f.label} doesn't look right.`);
    if (f.key === "apiUrl" && v && !/^https:\/\/[a-z0-9.-]+(\/[\w./-]*)?$/i.test(v)) throw fail(400, `${f.label} must be an https:// address.`);
    out[f.key] = f.key === "apiUrl" ? v.replace(/\/+$/, "") : v;
  }
  return out;
}

/* ---------------- Autotask test (zone lookup, then one signed-in call) ---------------- */
let fetchImpl = (...a) => fetch(...a);

async function testAutotask(c) {
  const zoneRes = await fetchImpl(`https://webservices.autotask.net/atservicesrest/v1.0/zoneInformation?user=${encodeURIComponent(c.username)}`, { signal: AbortSignal.timeout(15000) })
    .catch(() => { throw fail(502, "Couldn't reach Autotask to check the username. Try again in a minute."); });
  if (!zoneRes.ok) throw fail(400, "Autotask doesn't recognise that API username.");
  const zone = await zoneRes.json().catch(() => ({}));
  const base = String(zone.url || "").replace(/\/+$/, "");
  if (!/^https:\/\/webservices\d*\.autotask\.net\/atservicesrest$/i.test(base)) throw fail(400, "Autotask doesn't recognise that API username.");
  const res = await fetchImpl(`${base}/v1.0/ThresholdInformation`, {
    headers: { ApiIntegrationCode: c.integrationCode, UserName: c.username, Secret: c.secret, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  }).catch(() => { throw fail(502, "Couldn't reach Autotask. Try again in a minute."); });
  if (res.status === 401 || res.status === 403) throw fail(400, "Autotask rejected these credentials. Check the secret and the tracking identifier (integration code).");
  if (!res.ok) throw fail(502, `Autotask answered ${res.status}. Try again in a minute.`);
  return { baseUrl: base + "/", zone: zone.zoneName || null };
}

/** Tests where Pulse can, and returns the value to store plus a short note. */
async function prepare(name, fields) {
  const t = TYPES[name];
  if (t.kind === "autotask") {
    const r = await testAutotask(fields);
    return { value: { ...fields, baseUrl: r.baseUrl }, tested: true, note: `Signed in to Autotask${r.zone ? ` (${r.zone})` : ""}.` };
  }
  return { value: fields, tested: false, note: "Saved. Pulse checks it the first time it's used." };
}

module.exports = { TYPES, describe, validate, prepare, _test: { setFetch(f) { fetchImpl = f; } } };
