"use strict";
/**
 * Key Vault access over its REST API, signed in as the Function's managed identity.
 * Each identity can only reach the secrets it was granted (secret-level RBAC, set by
 * setup/pulse-setup.sh). Secret values are returned to the caller and must never be
 * logged, stored in SQL or sent to the browser.
 */
const { DefaultAzureCredential } = require("@azure/identity");

const API = "7.4";
let credential = null;
const cred = () => (credential = credential || new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID || undefined }));
const vaultUri = () => String(process.env.KEY_VAULT_URI || "").replace(/\/+$/, "");

async function call(method, path, body) {
  if (!vaultUri()) { const e = new Error("KEY_VAULT_URI is not configured."); e.status = 503; throw e; }
  const { token } = await cred().getToken("https://vault.azure.net/.default");
  const res = await fetch(`${vaultUri()}${path}${path.includes("?") ? "&" : "?"}api-version=${API}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) { const e = new Error(`Key Vault ${method} ${path.split("?")[0]}: HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

const PLACEHOLDER = "not-set";

/** { value, updatedAt, description } or null. value is null while the placeholder is in place. */
async function getSecret(name) {
  const s = await call("GET", `/secrets/${encodeURIComponent(name)}`);
  if (!s) return null;
  return {
    value: s.value === PLACEHOLDER ? null : s.value,
    updatedAt: s.attributes && s.attributes.updated ? new Date(s.attributes.updated * 1000).toISOString() : null,
    description: s.contentType || (s.tags && s.tags.description) || null,
  };
}

/** Writes a new version of a secret. Used by the Connections page (write-only) and token renewal. */
async function setSecret(name, value, tags = {}) {
  await call("PUT", `/secrets/${encodeURIComponent(name)}`, { value: String(value), tags });
}

module.exports = { getSecret, setSecret, PLACEHOLDER };
