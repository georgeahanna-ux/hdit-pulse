"use strict";
/**
 * Pulse API routes (func-hdit-pulse-api). All under /api.
 *
 *   GET  /health              public: version, whether sign-in and the database are set up, last sync run
 *   GET  /me                  the signed-in person, their roles and what they can do; records the sign-in
 *   GET  /calendar/week       Scorecard week facts (?week=YYYY-MM-DD, default: this week)
 *   POST /audit/view          record a view of a sensitive page { page }
 *   GET  /audit               audit log (Platform Admins, Compliance)
 *   /connections              Connections page (src/api/connections.js): Platform Admins enter, replace and remove credentials
 *
 * M1 EOS routes come from src/eos/: structure (divisions, seats, /me/summary), scorecard, rocks, issues, todos, vto, plan.
 */
const { VERSION } = require("../version");
const access = require("../lib/access");
const audit = require("../lib/audit");
const people = require("../lib/people");
const db = require("../lib/sql");
const entra = require("../lib/entra");
const time = require("../lib/time");
const { fail } = require("../lib/errors");

const actorOf = ctx => ({ oid: ctx.person.oid, name: ctx.person.name });

const SENSITIVE_PAGES = new Set(["finance-detail", "people-data", "audit-log", "access-review", "connections"]);

const routes = [
  {
    method: "GET", path: "/health", auth: "public",
    async fn() {
      let database = "not configured", lastSync = null;
      if (db.configured()) {
        try { database = (await db.ping()) ? "ok" : "error"; } catch { database = "unreachable"; }
        if (database === "ok") {
          try {
            const [r] = await db.query("SELECT TOP 1 job, started_at, finished_at, ok FROM pulse.sync_run ORDER BY id DESC");
            if (r) lastSync = { job: r.job, at: r.finished_at || r.started_at, ok: r.ok === null ? null : !!r.ok };
          } catch { /* table not there yet */ }
        }
      }
      return {
        status: "ok", component: "api", version: VERSION,
        environment: process.env.APP_ENVIRONMENT || "local",
        signIn: entra.configured() ? "entra" : "not configured",
        database, lastSync, time: new Date().toISOString(),
      };
    },
  },
  {
    method: "GET", path: "/me", auth: "person",
    async fn(ctx) {
      const p = ctx.person;
      let personId = null, firstSignIn = false, database = "ok";
      try {
        ({ id: personId, firstSignIn } = await people.touch(p));
        // First time here: link them to their Autotask resource straight away (D10), from what Pulse already knows.
        if (firstSignIn) await require("../people/directory").runMatching().catch(e => ctx.context && ctx.context.warn && ctx.context.warn("matching:", e.message));
        await audit.record({ actor: actorOf(ctx), action: "session.start", entity: { type: "person", id: p.oid },
          after: firstSignIn ? { firstSignIn: true } : undefined, request: ctx.request }, ctx.context);
      } catch (e) {
        // Sign-in still works if the database is briefly unavailable; the page shows a notice.
        database = "unavailable";
        if (ctx.context && ctx.context.warn) ctx.context.warn("me: database unavailable", e.message);
      }
      return {
        person: { id: personId, oid: p.oid, name: p.name, email: p.email, firstSignIn },
        roles: ctx.access.roles,
        access: access.describe(ctx.access),
        divisions: access.DIVISIONS,
        week: time.weekInfo(time.weekOf()),
        reviewWeek: time.weekInfo(time.reviewWeek()),
        environment: process.env.APP_ENVIRONMENT || "local",
        version: VERSION,
        database,
      };
    },
  },
  {
    method: "GET", path: "/calendar/week", auth: "person",
    async fn(ctx) {
      const w = ctx.query.week ? time.parseWeek(ctx.query.week) : time.weekOf();
      if (!w) throw fail(400, "A week is named by its Monday, e.g. 2026-11-02.");
      return time.weekInfo(w);
    },
  },
  {
    method: "POST", path: "/audit/view", auth: "person",
    async fn(ctx) {
      const page = String(ctx.body.page || "");
      if (!SENSITIVE_PAGES.has(page)) throw fail(400, "Unknown page.");
      await audit.record({ actor: actorOf(ctx), action: "view." + page, entity: ctx.body.id ? { type: page, id: ctx.body.id } : null, request: ctx.request }, ctx.context);
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/audit", auth: "person", allow: a => a.viewAudit,
    async fn(ctx) {
      const q = ctx.query;
      const events = await audit.list({ from: q.from, to: q.to, actor: q.actor, action: q.action, entityType: q.entityType, entityId: q.entityId, limit: q.limit });
      await audit.record({ actor: actorOf(ctx), action: "view.audit-log", after: { filters: q, rows: events.length }, request: ctx.request }, ctx.context);
      return { events };
    },
  },
];

// Release 1 EOS modules (M1)
for (const m of ["structure", "scorecard", "rocks", "issues", "todos", "vto", "plan"]) routes.push(...require(`../eos/${m}`).routes);
routes.push(...require("./connections").routes);
routes.push(...require("./people").routes);
routes.push(...require("../projects/routes").routes);

module.exports = { routes, SENSITIVE_PAGES };
