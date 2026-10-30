"use strict";
/**
 * Checks Microsoft Entra ID access tokens for the HD IT Pulse app registration.
 * Same checks as pulse-auth.js in the three apps: signature against Entra's published keys,
 * issuer = our tenant, audience = Pulse, not expired. Then either:
 *   - a person: delegated scope "access_as_user" and an object id, or
 *   - a service (app-only): no scope, the required app role (e.g. Pulse.Collector).
 *
 * Settings: ENTRA_TENANT_ID, ENTRA_CLIENT_ID.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { fail } = require("./errors");

const cfg = () => ({
  tenantId: String(process.env.ENTRA_TENANT_ID || "").trim().toLowerCase(),
  clientId: String(process.env.ENTRA_CLIENT_ID || "").trim().toLowerCase(),
});
const configured = () => { const c = cfg(); return !!(c.tenantId && c.clientId); };

/* ------------------------------ signing keys ------------------------------ */
let keys = new Map(), keysAt = 0, keysFetching = null;
const KEYS_TTL = 12 * 3600e3;
const KEYS_MIN_REFRESH = 5 * 60e3;

async function fetchKeys() {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(cfg().tenantId)}/discovery/v2.0/keys`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw fail(503, "Couldn't reach Microsoft to check your sign-in. Try again in a minute.");
  const body = await res.json();
  const next = new Map();
  for (const k of body.keys || []) {
    if (k.kty !== "RSA" || !k.kid || (k.use && k.use !== "sig")) continue;
    try { next.set(k.kid, crypto.createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e }, format: "jwk" })); } catch { /* skip */ }
  }
  keys = next; keysAt = Date.now();
}
async function keyFor(kid) {
  const age = Date.now() - keysAt;
  if (age > KEYS_TTL || (!keys.has(kid) && age > KEYS_MIN_REFRESH)) {
    try {
      keysFetching = keysFetching || fetchKeys().finally(() => { keysFetching = null; });
      await keysFetching;
    } catch (e) { if (!keys.size) throw e; }
  }
  return keys.get(kid) || null;
}

function decodeHeader(token) {
  return JSON.parse(Buffer.from(String(token).split(".")[0] || "", "base64url").toString("utf8"));
}

async function verify(token) {
  if (!configured()) throw fail(503, "Pulse sign-in isn't configured on the server yet.");
  const c = cfg();
  let header;
  try { header = decodeHeader(token); } catch { throw fail(401, "Your sign-in couldn't be read. Reload Pulse and try again."); }
  if (header.alg !== "RS256") throw fail(401, "Your sign-in couldn't be verified. Reload Pulse and try again.");
  const key = await keyFor(header.kid);
  if (!key) throw fail(401, "Your sign-in couldn't be verified. Reload Pulse and try again.");
  let claims;
  try {
    claims = jwt.verify(token, key, {
      algorithms: ["RS256"],
      audience: [c.clientId, `api://${c.clientId}`],
      issuer: [`https://login.microsoftonline.com/${c.tenantId}/v2.0`, `https://sts.windows.net/${c.tenantId}/`],
      clockTolerance: 120,
    });
  } catch (e) {
    throw fail(401, e && e.name === "TokenExpiredError"
      ? "Your sign-in has expired. Reload Pulse to continue."
      : "Your sign-in couldn't be verified. Reload Pulse and try again.");
  }
  if (String(claims.tid || "").toLowerCase() !== c.tenantId) throw fail(401, "That sign-in is from a different organisation.");
  return claims;
}

const emailsOf = claims => [...new Set([claims.preferred_username, claims.email, claims.upn, claims.unique_name]
  .filter(Boolean).map(x => String(x).trim().toLowerCase()))];

/** A person using Pulse. Returns { oid, name, email, emails, roles }. */
async function verifyPerson(token) {
  const claims = await verify(token);
  const scopes = String(claims.scp || "").split(" ");
  if (!scopes.includes("access_as_user")) throw fail(401, "That sign-in isn't for a person using Pulse.");
  if (!claims.oid) throw fail(401, "That sign-in doesn't identify a person.");
  const emails = emailsOf(claims);
  return {
    oid: String(claims.oid), name: claims.name || emails[0] || "Signed-in user",
    email: emails[0] || "", emails, roles: Array.isArray(claims.roles) ? claims.roles.map(String) : [],
  };
}

/** A Pulse service calling with its managed identity. Requires the given app role. */
async function verifyService(token, role) {
  const claims = await verify(token);
  if (claims.scp) throw fail(403, "This endpoint is for Pulse services only.");
  const roles = Array.isArray(claims.roles) ? claims.roles.map(String) : [];
  if (!roles.includes(role)) throw fail(403, `This service doesn't have the ${role} role.`);
  return { oid: String(claims.oid || ""), appId: String(claims.azp || claims.appid || ""), roles };
}

const bearer = request => {
  const h = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : "";
};

module.exports = {
  configured, verifyPerson, verifyService, bearer, emailsOf,
  _test: { setKeys(map) { keys = map; keysAt = Date.now(); } },
};
