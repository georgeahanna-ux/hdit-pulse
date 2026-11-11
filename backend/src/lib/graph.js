"use strict";
/**
 * Microsoft Graph, signed in as the sync service's managed identity (no secrets).
 * Permissions (granted by pulse-setup.sh release1-entra): User.Read.All, GroupMember.Read.All,
 * Tasks.ReadWrite.All.
 */
const { DefaultAzureCredential } = require("@azure/identity");

const G = "https://graph.microsoft.com/v1.0";
let credential = null;
const cred = () => (credential = credential || new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID || undefined }));

async function get(pathOrUrl) {
  const { token } = await cred().getToken("https://graph.microsoft.com/.default");
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : G + pathOrUrl;
  if (!url.startsWith(G)) throw new Error("Refusing to send a Graph token to another address.");
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) { const e = new Error(`Microsoft Graph ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`); e.status = res.status; throw e; }
  return res.json();
}

/** Every page of a Graph collection. */
async function all(path) {
  const out = [];
  let next = path, pages = 0;
  while (next && pages < 100) { const r = await get(next); out.push(...(r.value || [])); next = r["@odata.nextLink"]; pages++; }
  return out;
}

/**
 * A write (or a read that needs headers) for Planner: POST, PATCH or DELETE, with If-Match when an
 * ETag is given. Returns { status, body, etag }. Rate limits (429) are waited out a few times.
 */
let fetchImpl = (...a) => fetch(...a);
async function send(method, path, body, { etag = null } = {}) {
  const url = G + path;
  for (let attempt = 0; ; attempt++) {
    const { token } = await cred().getToken("https://graph.microsoft.com/.default");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" };
    if (etag) headers["if-match"] = etag;
    const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if ((res.status === 429 || res.status === 503) && attempt < 4) { await new Promise(r => setTimeout(r, (Number(res.headers.get("retry-after")) || 2 ** attempt * 2) * 1000)); continue; }
    const text = await res.text().catch(() => "");
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) { const e = new Error(`Microsoft Graph ${res.status}: ${((json && json.error && json.error.message) || text).slice(0, 300)}`); e.status = res.status; throw e; }
    return { status: res.status, body: json, etag: (json && json["@odata.etag"]) || res.headers.get("etag") || null };
  }
}

const USER_FIELDS = "id,displayName,givenName,surname,userPrincipalName,mail,otherMails,proxyAddresses,accountEnabled,userType,jobTitle,department,assignedLicenses";
const users = () => all(`/users?$select=${USER_FIELDS}&$top=999`);

module.exports = { get, all, users, send, _test: { setFetch(f) { fetchImpl = f; }, setCred(c) { credential = c; } } };
