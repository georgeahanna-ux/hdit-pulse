"use strict";
/**
 * HD IT Pulse backend. The same package runs as two Function Apps:
 *   PULSE_COMPONENT=api   func-hdit-pulse-api   user-facing HTTP API (catch-all route under /api)
 *   PULSE_COMPONENT=sync  func-hdit-pulse-sync  timers and integrations; only /api/health over HTTP
 * Each registers only its own functions, and each runs as its own managed identity with
 * access to only its own Key Vault secrets (D7).
 */
const { app } = require("@azure/functions");
const { router, json } = require("./lib/http");
const { VERSION } = require("./version");

const component = String(process.env.PULSE_COMPONENT || "api").toLowerCase();

if (component === "api") {
  const { routes } = require("./api/routes");
  app.http("pulse", {
    route: "{*path}",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    authLevel: "anonymous",
    handler: router(routes),
  });
} else if (component === "sync") {
  const jobs = require("./sync/jobs");
  app.http("health", {
    route: "health", methods: ["GET"], authLevel: "anonymous",
    handler: async () => json(200, { status: "ok", component: "sync", version: VERSION, environment: process.env.APP_ENVIRONMENT || "local" }),
  });
  // Hourly at :07 past (UTC).
  app.timer("connections", {
    schedule: "0 7 * * * *", runOnStartup: false,
    handler: (_t, context) => jobs.run("connections", context, jobs.checkConnections),
  });
  // Autotask departments and resources every 15 minutes (D16).
  app.timer("departments", {
    schedule: "0 2/15 * * * *", runOnStartup: false,
    handler: (_t, context) => jobs.runIfConnected("departments", context, jobs.syncDepartments),
  });
  // Full directory (Entra and Autotask) nightly at 15:40 UTC (1:40 or 2:40am Sydney).
  app.timer("directory", {
    schedule: "0 40 15 * * *", runOnStartup: false,
    handler: (_t, context) => jobs.run("directory", context, jobs.syncDirectory),
  });
  // Jobs asked for from Pulse ("Refresh now"), every two minutes.
  app.timer("requests", {
    schedule: "0 */2 * * * *", runOnStartup: false,
    handler: (_t, context) => jobs.runRequests(context),
  });
} else {
  throw new Error(`Unknown PULSE_COMPONENT "${component}" (expected api or sync).`);
}
