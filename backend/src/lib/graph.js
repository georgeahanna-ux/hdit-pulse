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

const USER_FIELDS = "id,displayName,givenName,surname,userPrincipalName,mail,otherMails,proxyAddresses,accountEnabled,userType,jobTitle,department,assignedLicenses";
const users = () => all(`/users?$select=${USER_FIELDS}&$top=999`);

module.exports = { get, all, users };
