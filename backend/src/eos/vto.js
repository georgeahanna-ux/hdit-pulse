"use strict";
/**
 * V/TO: everyone signed in can read it (D3); Leadership edits. Every version is kept.
 *   GET /vto                       all sections
 *   PUT /vto/:key { content }      (leadership)
 *   GET /vto/:key/history          (leadership) previous versions, newest first
 */
const db = require("../lib/sql");
const C = require("./common");

async function get() {
  const rows = await db.query("SELECT [key], title, content, sort, updated_by, updated_at FROM pulse.vto_section ORDER BY sort");
  return { sections: rows.map(r => ({ key: r.key, title: r.title, content: r.content || "", updatedBy: r.updated_by, updatedAt: r.updated_at })) };
}

async function put(ctx) {
  const key = String(ctx.params.key);
  const [s] = await db.query("SELECT [key], content FROM pulse.vto_section WHERE [key] = @key", { key });
  if (!s) throw C.fail(404, "That V/TO section doesn't exist.");
  const content = C.text(ctx.body.content, 20000);
  if ((content || null) === (s.content || null)) return { ok: true };
  await db.query("UPDATE pulse.vto_section SET content = @content, updated_by = @by, updated_at = SYSUTCDATETIME() WHERE [key] = @key",
    { key, content, by: ctx.person.name });
  await C.record(ctx, "vto.update", { type: "vto", id: key }, { content: s.content }, { content });
  return { ok: true };
}

async function history(ctx) {
  const key = String(ctx.params.key);
  const rows = await db.query(
    `SELECT TOP (50) content, updated_by, updated_at, valid_from FROM pulse.vto_section FOR SYSTEM_TIME ALL
      WHERE [key] = @key ORDER BY valid_from DESC`, { key });
  return { versions: rows.map(r => ({ content: r.content || "", updatedBy: r.updated_by, updatedAt: r.updated_at })) };
}

const routes = [
  { method: "GET", path: "/vto", auth: "person", fn: get },
  { method: "PUT", path: "/vto/:key", auth: "person", allow: a => a.leadership, fn: put },
  { method: "GET", path: "/vto/:key/history", auth: "person", allow: a => a.leadership, fn: history },
];
module.exports = { routes };
