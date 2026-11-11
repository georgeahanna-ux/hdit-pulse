"use strict";
/**
 * The "links" job (D11, 0.8.0), every 5 minutes in the sync service: To-dos <-> Planner, then
 * the progress and status of linked Rocks and Issues. Each part runs on its own; one failing
 * doesn't stop the others, but the run is marked failed so it shows.
 */
const planner = require("./planner");
const progress = require("./progress");

async function runLinks({ graph = require("../lib/graph"), now = new Date(), autotaskReady = async () => true } = {}) {
  const notes = [], failed = [];
  const step = async (name, fn) => { try { notes.push(`${name}: ${await fn()}`); } catch (e) { failed.push(`${name}: ${e.message}`); } };
  if (await planner.setting("planner.l10_plan_id")) {
    await step("plans", () => planner.refreshPlans(graph));
    await step("to-dos", () => planner.syncTodos(graph, now));
  } else notes.push("Planner: no L10 plan set");
  await step("rocks", () => progress.rocks(graph));
  if (await autotaskReady()) await step("issues", () => progress.issues());
  if (failed.length) throw new Error([...failed, ...notes].join("; ").slice(0, 1900));
  return notes.join("; ");
}

module.exports = { runLinks };
