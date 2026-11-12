"use strict";
/**
 * Azure OpenAI (0.11.0), signed in as the sync service's managed identity: the resource has keys
 * switched off, so there's no secret. Regional Standard deployment in Australia East, so prompts and
 * answers are processed in Australia (decided 12 Nov 2026). Used only for ticket sentiment.
 *
 *   POST {AOAI_ENDPOINT}openai/deployments/{AOAI_DEPLOYMENT}/chat/completions?api-version=2024-10-21
 *
 * Text sent is never logged here; callers decide what may be sent (see clients/sentiment.js).
 */
const { DefaultAzureCredential } = require("@azure/identity");

const API_VERSION = "2024-10-21";
const SCOPE = "https://cognitiveservices.azure.com/.default";
let credential = null;
const cred = () => (credential = credential || new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID || undefined }));
let fetchImpl = (...a) => fetch(...a);
let tokenImpl = async () => (await cred().getToken(SCOPE)).token;

const endpoint = () => String(process.env.AOAI_ENDPOINT || "").replace(/\/+$/, "");
const deployment = () => String(process.env.AOAI_DEPLOYMENT || "").trim();
const configured = () => /^https:\/\/[a-z0-9-]+\.openai\.azure\.com$/i.test(endpoint()) && !!deployment();

function fail(message, code, status) { const e = new Error(message); e.code = code; if (status) e.status = status; return e; }

/**
 * One chat completion that must answer with JSON matching `schema` (structured outputs).
 * Returns the parsed object and the tokens used.
 */
async function json({ system, user, schema, name = "result", maxTokens = 1500 }) {
  if (!configured()) throw fail("Azure OpenAI isn't set up for Pulse yet.", "not-configured");
  const url = `${endpoint()}/openai/deployments/${encodeURIComponent(deployment())}/chat/completions?api-version=${API_VERSION}`;
  const body = {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0, max_tokens: maxTokens,
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      method: "POST", headers: { authorization: `Bearer ${await tokenImpl()}`, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || Math.min(60000, 3000 * 2 ** attempt);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw fail("Azure OpenAI refused Pulse's sync service. Run \"bash pulse-setup.sh release1\" again so it may call Azure OpenAI.", "forbidden", 502);
    if (res.status === 404) throw fail(`Azure OpenAI has no deployment "${deployment()}" yet.`, "not-configured", 502);
    if (!res.ok) {
      let msg = ""; try { const j = await res.json(); msg = (j.error && (j.error.code || j.error.message)) || ""; } catch { /* not JSON */ }
      // A content filter refusal isn't a reason to stop the whole run: the caller skips that batch.
      throw fail(`Azure OpenAI answered ${res.status}${msg ? ` (${String(msg).slice(0, 120)})` : ""}.`, msg === "content_filter" ? "filtered" : "error", 502);
    }
    const j = await res.json();
    const choice = (j.choices || [])[0] || {};
    if (choice.finish_reason === "content_filter") throw fail("Azure OpenAI's content filter held back the answer.", "filtered", 502);
    let parsed;
    try { parsed = JSON.parse((choice.message || {}).content || ""); } catch { throw fail("Azure OpenAI's answer wasn't valid JSON.", "bad-answer", 502); }
    return { value: parsed, tokens: (j.usage && j.usage.total_tokens) || 0, model: j.model || deployment() };
  }
}

module.exports = { configured, json, deployment, endpoint, _test: { setFetch(f) { fetchImpl = f; }, setToken(f) { tokenImpl = f; } } };
