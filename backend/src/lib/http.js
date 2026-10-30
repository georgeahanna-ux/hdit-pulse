"use strict";
/**
 * A small router for the single catch-all HTTP function. Each route says who may call it:
 *   auth: "public"   no sign-in (health only)
 *   auth: "person"   a signed-in person with any Pulse role; handler gets ctx.person and ctx.access
 *   auth: "service"  a Pulse service's managed identity holding route.role
 * plus an optional allow(access) check that returns false → 403.
 *
 * CORS is handled by the Functions platform (allowed origins are set in Bicep), so no
 * Access-Control-Allow-Origin header is added here.
 */
const entra = require("./entra");
const { accessFor } = require("./access");
const { fail } = require("./errors");

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const json = (status, body) => ({ status, jsonBody: body, headers: SECURITY_HEADERS });

function compile(routes) {
  return routes.map(r => {
    const names = [];
    const re = new RegExp("^" + r.path.replace(/\/+$/, "").replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "/?$");
    return { ...r, re, names };
  });
}

function find(compiled, method, path) {
  let pathMatched = false;
  for (const r of compiled) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    return { route: r, params };
  }
  return { route: null, pathMatched };
}

async function readBody(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return {};
  const text = await request.text();
  if (!text) return {};
  if (text.length > 256 * 1024) throw fail(413, "That request is too large.");
  try { return JSON.parse(text); } catch { throw fail(400, "That request wasn't valid JSON."); }
}

/** Builds the Functions handler for a route table. */
function router(routes, { verifyPerson = entra.verifyPerson, verifyService = entra.verifyService } = {}) {
  const compiled = compile(routes);
  return async function handle(request, context) {
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") return { status: 204, headers: SECURITY_HEADERS };
    const path = "/" + String((request.params && request.params.path) || "").replace(/^\/+|\/+$/g, "");
    try {
      const { route, params, pathMatched } = find(compiled, method, path);
      if (!route) throw fail(pathMatched ? 405 : 404, pathMatched ? "That isn't allowed here." : "Not found.");
      const ctx = { request, context, params, query: Object.fromEntries(new URL(request.url).searchParams) };
      if (route.auth !== "public") {
        const token = entra.bearer(request);
        if (!token) throw fail(401, "Please sign in to Pulse.");
        if (route.auth === "service") {
          ctx.service = await verifyService(token, route.role);
        } else {
          ctx.person = await verifyPerson(token);
          ctx.access = accessFor(ctx.person.roles);
          if (!ctx.access.signIn) throw fail(403, "You don't have access to Pulse yet. Ask a Platform Admin to add you to a Pulse group.", "no-access");
          if (route.allow && !route.allow(ctx.access)) throw fail(403, "You don't have access to that.", "forbidden");
        }
      }
      ctx.body = await readBody(request);
      const out = await route.fn(ctx);
      if (out && typeof out === "object" && "status" in out && ("jsonBody" in out || "body" in out)) {
        return { ...out, headers: { ...SECURITY_HEADERS, ...(out.headers || {}) } };
      }
      return json(200, out === undefined ? { ok: true } : out);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500 && context && context.error) context.error(`[${method} ${path}]`, e && e.stack || e);
      else if (context && context.warn) context.warn(`[${method} ${path}] ${status} ${e.message}`);
      return json(status, { error: e.expose ? e.message : "Something went wrong. Try again, and tell a Platform Admin if it keeps happening.", code: e.code || undefined });
    }
  };
}

module.exports = { router, json, SECURITY_HEADERS, _test: { compile, find } };
