"use strict";
// Helpers shared by the EOS route modules.
const access = require("../lib/access");
const audit = require("../lib/audit");
const { fail } = require("../lib/errors");
const { requireReason, isoDay } = require("./logic");

const actorOf = ctx => ({ oid: ctx.person.oid, name: ctx.person.name });

/** Is this email one of the signed-in person's addresses? */
const isMe = (ctx, email) => !!email && ctx.person.emails.includes(String(email).trim().toLowerCase());

const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
/** Is this seat holder the signed-in person? By email when the holder has one, otherwise by name
 *  (seat holders loaded from the Accountability Chart have names only until 0.6.0 fills in emails). */
const isMeHolder = (ctx, h) => (h.email ? isMe(ctx, h.email) : !!h.name && norm(h.name) === norm(ctx.person.name));

const DIVISION_CODES = access.DIVISION_CODES;
function division(code, { optional = false } = {}) {
  if (!code && optional) return null;
  if (!DIVISION_CODES.includes(code)) throw fail(400, "Choose a valid division.");
  return code;
}

/** Can see everything for a division (D3): leadership, or that division's own people. */
const seesDivision = (ctx, code) => ctx.access.leadership || ctx.access.ownDivisions.includes(code);

function text(v, max, { required = false, label = "That field" } = {}) {
  const s = String(v ?? "").trim();
  if (required && !s) throw fail(400, `${label} is required.`);
  if (s.length > max) throw fail(400, `${label} is too long (${max} characters at most).`);
  return s || null;
}

function email(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 320) throw fail(400, "That email address doesn't look right.");
  return s;
}

function date(v, { required = false, label = "Date" } = {}) {
  if (!v) { if (required) throw fail(400, `${label} is required.`); return null; }
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw fail(400, `${label} must be a date.`);
  return s;
}

function reason(v) {
  const r = requireReason(v);
  if (!r) throw fail(400, "Please give a reason (at least a few words). It's kept in the audit log.");
  return r;
}

function int(v, label = "Id") {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw fail(400, `${label} isn't valid.`);
  return n;
}

const record = (ctx, action, entity, before, after, why) =>
  audit.record({ actor: actorOf(ctx), action, entity, before, after, reason: why, request: ctx.request }, ctx.context);

const day = isoDay;

module.exports = { actorOf, isMe, isMeHolder, norm, division, seesDivision, text, email, date, reason, int, record, day, fail };
