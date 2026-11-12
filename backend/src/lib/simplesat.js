"use strict";
/**
 * SimpleSAT API (v1), read-only. The API key is entered on the Connections page and kept in
 * Key Vault ("simplesat"); only the sync service can read it. It is sent in the
 * X-Simplesat-Token header and never logged.
 *
 *   POST https://api.simplesat.io/api/v1/answers/search?page_size=100
 *        { "start_date": ISO, "end_date": ISO }   → { answers, count, next, previous }
 * Pages are followed by POSTing the same body to "next" until it is null.
 */
const vault = require("./vault");

const API = "https://api.simplesat.io/api/v1";
let fetchImpl = (...a) => fetch(...a);

function fail(message, code) { const e = new Error(message); if (code) e.code = code; return e; }

async function apiKey() {
  const s = await vault.getSecret("simplesat");
  if (!s || !s.value) throw fail("The SimpleSAT API key hasn't been entered yet (Connections → SimpleSAT).", "not-connected");
  let c; try { c = JSON.parse(s.value); } catch { c = { apiKey: s.value }; }
  if (!c.apiKey) throw fail("The SimpleSAT API key is missing. Enter it again under Connections.");
  return c.apiKey;
}

async function post(url, body, key) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "x-simplesat-token": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if ((res.status === 429 || res.status === 503) && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || Math.min(30000, 2000 * 2 ** attempt);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw fail("SimpleSAT refused the API key. Check it under Connections → SimpleSAT (Admin → Account Settings in SimpleSAT).");
    if (!res.ok) throw fail(`SimpleSAT answered ${res.status} to ${url.replace(API, "").split("?")[0]}.`);
    return res.json();
  }
}

/** Every answer (or response) between two instants (ISO strings), all pages. */
async function search(kind, start, end, { max = 200, partial = false } = {}) {
  const key = await apiKey();
  const body = { start_date: start, end_date: end };
  const out = [];
  let url = `${API}/${kind}/search?page_size=100`, pages = 0;
  while (url && pages < max) {
    const json = await post(url, body, key);
    out.push(...(json[kind] || json.results || []));
    url = json.next || null;
    pages++;
  }
  if (url && !partial) throw fail(`SimpleSAT returned more than ${max} pages of ${kind}, so Pulse stopped reading (to protect the API).`);
  return out;
}
const answers = (start, end, opts) => search("answers", start, end, opts);
/** Responses carry the customer, the ticket and the team member as well as the answers. */
const responses = (start, end, opts) => search("responses", start, end, opts);

module.exports = { API, apiKey, answers, responses, _test: { setFetch(f) { fetchImpl = f; } } };
