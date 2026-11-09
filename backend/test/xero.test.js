"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("../src/collect/xero");

const row = (name, value, account) => ({ RowType: "Row", Cells: [{ Value: name, Attributes: account ? [{ Id: "account", Value: account }] : [] }, { Value: String(value) }] });
const sum = (name, value) => ({ RowType: "SummaryRow", Cells: [{ Value: name }, { Value: String(value) }] });
const report = rows => ({ Reports: [{ Rows: [{ RowType: "Header", Cells: [] }, ...rows] }] });
// An Australian Xero P&L: Trading Income, Cost of Sales, Gross Profit, Other Income, Operating Expenses, Net Profit.
const PL = report([
  { RowType: "Section", Title: "Trading Income", Rows: [row("Managed services", 500000, "a1"), row("Project services", 200000, "a2"), row("Hardware sales", 60000, "a3"), sum("Total Trading Income", 760000)] },
  { RowType: "Section", Title: "Cost of Sales", Rows: [row("Service delivery wages", 250000, "c1"), row("Hardware purchases", 50000, "c2"), sum("Total Cost of Sales", 300000)] },
  { RowType: "Section", Title: "", Rows: [row("Gross Profit", 460000)] },
  { RowType: "Section", Title: "Other Income", Rows: [row("Interest Income", 1000, "o1"), sum("Total Other Income", 1000)] },
  { RowType: "Section", Title: "Operating Expenses", Rows: [row("Wages and Salaries", 370000, "e1"), row("Depreciation", 8000, "e2"), row("Interest Expense", 2000, "e3"), row("Rent", 11000, "e4"), sum("Total Operating Expenses", 391000)] },
  { RowType: "Section", Title: "", Rows: [row("Net Profit", 70000)] },
]);

test("profit and loss: revenue is trading income only; gross and net profit from Xero's own rows", () => {
  const pl = X.profitAndLoss(PL);
  assert.deepEqual([pl.revenue, pl.cost, pl.gross, pl.net, pl.otherIncome], [760000, 300000, 460000, 70000, 1000]);
});

test("EBITDA adds back depreciation, amortisation, interest and tax expense, and takes off interest income", () => {
  const e = X.ebitda(X.profitAndLoss(PL));
  assert.equal(e.value, 70000 + 8000 + 2000 - 1000);
  assert.deepEqual(e.addBack, ["Depreciation", "Interest Expense"]);
});

test("SGM by SLI reporting codes, or the whole business's gross margin until they're set", () => {
  const pl = X.profitAndLoss(PL);
  const codes = new Map([["a1", "REV.SRV"], ["a2", "REV.SRV.PRJ"], ["a3", "REV.HW"], ["c1", "COS.SRV"], ["c2", "COS.HW"]]);
  const s = X.servicesMargin(pl, codes, ["REV.SRV"], ["COS.SRV"]);
  assert.equal(s.value, Math.round(1000 * (700000 - 250000) / 700000) / 10);   // 64.3
  const all = X.servicesMargin(pl, null, [], []);
  assert.equal(all.value, 60.5);
  assert.match(all.text, /Whole-business gross margin/);
});

test("cash from Bank Summary totals; receivables from the Balance Sheet", () => {
  const bank = report([{ RowType: "Section", Title: "", Rows: [
    { RowType: "Row", Cells: [{ Value: "Operating" }, { Value: "1" }, { Value: "2" }, { Value: "3" }, { Value: "612400.00" }] },
    { RowType: "Row", Cells: [{ Value: "Savings" }, { Value: "1" }, { Value: "2" }, { Value: "3" }, { Value: "250000.00" }] },
    { RowType: "SummaryRow", Cells: [{ Value: "Total" }, { Value: "" }, { Value: "" }, { Value: "" }, { Value: "862400.00" }] }] }]);
  assert.deepEqual(X.cashFrom(bank), { value: 862400, accounts: 2 });
  const bs = report([{ RowType: "Section", Title: "Current Assets", Rows: [row("Accounts Receivable", 420000), row("Prepayments", 5000), sum("Total Current Assets", 425000)] }]);
  assert.equal(X.receivablesFrom(bs), 420000);
});

test("Xero sign-in asks only for read-only scopes and goes back to the sync app's callback", () => {
  process.env.PULSE_SYNC_URL = "https://func-hdit-pulse-sync-test-aue.azurewebsites.net";
  const lib = require("../src/lib/xero");
  const u = new URL(lib.authorizeUrl("CLIENT", "s".repeat(43)));
  assert.equal(u.origin + u.pathname, "https://login.xero.com/identity/connect/authorize");
  assert.equal(u.searchParams.get("redirect_uri"), "https://func-hdit-pulse-sync-test-aue.azurewebsites.net/api/xero/callback");
  const scopes = u.searchParams.get("scope").split(" ");
  assert.ok(scopes.includes("offline_access"));
  assert.ok(scopes.filter(s => s !== "offline_access").every(s => s.endsWith(".read")), "read-only scopes only");
});

test("each run renews the token once and saves Xero's new refresh token before using it", async () => {
  const vault = require("../src/lib/vault");
  const db = require("../src/lib/sql");
  const lib = require("../src/lib/xero");
  const saved = [];
  vault.getSecret = async n => ({ value: n === "xero-app" ? JSON.stringify({ clientId: "id", clientSecret: "sec" }) : JSON.stringify({ refreshToken: "old", tenantId: "t1", tenantName: "HD IT Pty Ltd" }) });
  vault.setSecret = async (n, v) => saved.push([n, JSON.parse(v)]);
  db._test.use({ async query() { return []; } });
  const calls = [];
  lib._test.setFetch(async (url, opt) => {
    calls.push({ url, opt });
    if (url.includes("identity.xero.com")) return { ok: true, status: 200, json: async () => ({ access_token: "AT", refresh_token: "new" }) };
    return { ok: true, status: 200, json: async () => ({ Reports: [] }), headers: { get: () => null } };
  });
  const x = await lib.session();
  assert.equal(saved[0][0], "xero-token");
  assert.equal(saved[0][1].refreshToken, "new");
  assert.match(new URLSearchParams(calls[0].opt.body).get("refresh_token"), /^old$/);
  await x.get("Reports/BankSummary", { fromDate: "2026-11-08", toDate: "2026-11-08" });
  const api = calls[1];
  assert.equal(api.opt.headers["xero-tenant-id"], "t1");
  assert.equal(api.opt.method, undefined, "GET only");
});
