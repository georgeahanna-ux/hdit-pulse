"use strict";
/**
 * Finance measurables from Xero (D4 items 12–15) and FY plan revenue (D19), read-only.
 *
 *   Cash on hand   bank accounts' closing balances at the end of the week (Bank Summary)
 *   Debtor days    accounts receivable at the end of the week ÷ the last 91 days' revenue
 *                  including GST, × 91 (Balance Sheet, Profit and Loss)
 *   SGM            services gross margin for the month so far: services revenue less services
 *                  cost ÷ services revenue, by the SLI reporting codes set in Pulse; until those
 *                  are set, the whole business's gross margin (marked as such)
 *   EBITDA %       net profit plus depreciation, amortisation, interest and income tax, less
 *                  interest income, ÷ revenue, for the month so far
 *   Revenue        a month's trading income (FY plan)
 * Monthly figures are provisional until Finance closes the month (D5).
 */
const db = require("../lib/sql");
const time = require("../lib/time");

const num = v => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const r1 = x => Math.round(x * 10) / 10;
const money = x => (x < 0 ? "−$" : "$") + Math.round(Math.abs(x)).toLocaleString("en-AU");

/** Flattens a Xero report into sections: [{ title, rows: [{ name, accountId, value }], total }] plus loose rows. */
function parseReport(json) {
  const rep = json && json.Reports && json.Reports[0];
  if (!rep) return { sections: [], rows: [] };
  const sections = [], loose = [];
  const rowOf = r => ({ name: (r.Cells[0] || {}).Value || "", accountId: (((r.Cells[0] || {}).Attributes || []).find(a => a.Id === "account") || {}).Value || null,
    value: num((r.Cells[r.Cells.length - 1] || {}).Value), cells: r.Cells.map(c => c.Value) });
  for (const s of rep.Rows || []) {
    if (s.RowType !== "Section") continue;
    const rows = (s.Rows || []).filter(r => r.RowType === "Row").map(rowOf);
    const sum = (s.Rows || []).find(r => r.RowType === "SummaryRow");
    if (s.Title) sections.push({ title: s.Title, rows, total: sum ? num(sum.Cells[sum.Cells.length - 1].Value) : rows.reduce((a, r) => a + r.value, 0), summary: sum ? sum.Cells.map(c => c.Value) : null });
    else loose.push(...rows);
  }
  return { sections, rows: loose };
}

/** Profit and loss in parts: income (trading), other income, cost of sales, expenses, gross and net profit. */
function profitAndLoss(json) {
  const p = parseReport(json);
  const pick = re => p.sections.filter(s => re.test(s.title));
  const sum = list => list.reduce((a, s) => a + s.total, 0);
  const income = pick(/income|revenue|sales/i).filter(s => !/other/i.test(s.title) && !/cost/i.test(s.title));
  const other = pick(/other income/i);
  const cost = pick(/cost of sales|direct cost|cost of goods/i);
  const expenses = pick(/expense|overhead/i);
  const loose = name => (p.rows.find(r => new RegExp(name, "i").test(r.name)) || {}).value;
  const revenue = sum(income);
  const gross = loose("^gross profit") ?? revenue - sum(cost);
  const net = loose("^net profit") ?? revenue + sum(other) - sum(cost) - sum(expenses);
  const rows = s => s.flatMap(x => x.rows);
  return { revenue, otherIncome: sum(other), cost: sum(cost), expenses: sum(expenses), gross, net,
    incomeRows: rows(income), otherRows: rows(other), costRows: rows(cost), expenseRows: rows(expenses) };
}

/** EBITDA from a P&L: net profit + depreciation, amortisation, interest and income tax expense − interest income. */
function ebitda(pl) {
  const addBack = pl.expenseRows.concat(pl.costRows).filter(r => /depreciat|amorti[sz]|interest|income tax/i.test(r.name));
  const interestIncome = pl.otherRows.concat(pl.incomeRows).filter(r => /interest/i.test(r.name));
  const back = addBack.reduce((a, r) => a + r.value, 0), less = interestIncome.reduce((a, r) => a + r.value, 0);
  return { value: pl.net + back - less, addBack: addBack.map(r => r.name), interestIncome: interestIncome.map(r => r.name) };
}

/**
 * Services gross margin. byAccount: Finance's own list of account codes (decided 10 Nov 2026), matched
 * on each P&L line's Xero account code; else SLI reporting codes; else the whole business's gross margin.
 * codeOf: accountId → { code, reportingCode }.
 */
function servicesMargin(pl, codeOf, rev, cost, byAccount = null) {
  if (codeOf && byAccount && (byAccount.rev.length || byAccount.cost.length)) {
    const acc = r => (codeOf.get(r.accountId) || {}).code || "";
    const sRevRows = pl.incomeRows.concat(pl.otherRows).filter(r => byAccount.rev.includes(acc(r)));
    const sCostRows = pl.costRows.concat(pl.expenseRows).filter(r => byAccount.cost.includes(acc(r)));
    const sRev = sRevRows.reduce((a, r) => a + r.value, 0), sCost = sCostRows.reduce((a, r) => a + r.value, 0);
    if (!sRev) return { value: null, text: "No services revenue this month yet (Finance's SGM accounts)." };
    return { value: r1((100 * (sRev - sCost)) / sRev), text: `Services revenue ${money(sRev)} (${sRevRows.length} accounts) less services cost ${money(sCost)} (${sCostRows.length} accounts), Finance's SGM account list.` };
  }
  if (codeOf && (rev.length || cost.length)) {
    const match = (r, list) => { const c = (codeOf.get(r.accountId) || {}).reportingCode || ""; return list.some(p => c === p || c.startsWith(p + ".")); };
    const sRev = pl.incomeRows.filter(r => match(r, rev)).reduce((a, r) => a + r.value, 0);
    const sCost = pl.costRows.concat(pl.expenseRows).filter(r => match(r, cost)).reduce((a, r) => a + r.value, 0);
    if (!sRev) return { value: null, text: "No services revenue this month yet (by the SLI reporting codes set in Pulse)." };
    return { value: r1((100 * (sRev - sCost)) / sRev), text: `Services revenue ${money(sRev)} less services cost ${money(sCost)} (SLI reporting codes ${rev.join(", ")} / ${cost.join(", ")}).` };
  }
  if (!pl.revenue) return { value: null, text: "No revenue this month yet." };
  return { value: r1((100 * pl.gross) / pl.revenue), text: `Whole-business gross margin for now: gross profit ${money(pl.gross)} of revenue ${money(pl.revenue)}. Set the SLI services codes in Pulse for the true SGM.` };
}

/** Bank Summary: total closing balance. */
function cashFrom(json) {
  // Bank Summary's section has no title, so read its rows directly: one per account, closing balance last.
  const rep = json && json.Reports && json.Reports[0];
  const sections = ((rep && rep.Rows) || []).filter(s => s.RowType === "Section");
  const rows = sections.flatMap(s => (s.Rows || []).filter(r => r.RowType === "Row"));
  const sum = sections.flatMap(s => (s.Rows || []).filter(r => r.RowType === "SummaryRow"))[0];
  const last = r => num((r.Cells[r.Cells.length - 1] || {}).Value);
  const total = sum ? last(sum) : rows.reduce((a, r) => a + last(r), 0);
  return { value: Math.round(total), accounts: rows.length };
}

/**
 * Balance Sheet: accounts receivable. Matched by Xero's system account (DEBTORS) where the chart of
 * accounts is available, otherwise by name. Every row of every section is read, titled or not.
 */
function receivablesFrom(json, accounts) {
  const rep = json && json.Reports && json.Reports[0];
  const rows = [];
  const walk = list => { for (const r of list || []) { if (r.RowType === "Row") rows.push(r); if (r.Rows) walk(r.Rows); } };
  walk(rep && rep.Rows);
  const shaped = rows.map(r => ({ name: String((r.Cells[0] || {}).Value || ""), accountId: (((r.Cells[0] || {}).Attributes || []).find(a => a.Id === "account") || {}).Value || null, value: num((r.Cells[1] || {}).Value) }));
  const bySystem = accounts ? shaped.filter(r => (accounts.get(r.accountId) || {}).system === "DEBTORS") : [];
  const hits = bySystem.length ? bySystem : shaped.filter(r => /receivable|debtors/i.test(r.name) && !/total|provision|doubtful|other/i.test(r.name));
  return { value: hits.reduce((a, r) => a + r.value, 0), names: hits.map(r => r.name) };
}

async function settings() {
  const rows = await db.query("SELECT [key], [value] FROM pulse.app_setting WHERE [key] LIKE N'xero.%'");
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const list = k => { try { const v = JSON.parse(s[k] || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
  const gst = Number(s["xero.gst_rate"]);
  return { gst: Number.isFinite(gst) ? gst : 0.1, sgmRevenue: list("xero.sgm_revenue_codes"), sgmCost: list("xero.sgm_cost_codes"),
    sgmAccounts: { rev: list("xero.sgm_revenue_accounts"), cost: list("xero.sgm_cost_accounts") } };
}

/** Account id → reporting code, for SGM. Needs accounting.settings.read. */
async function reportingCodes(x, cache) {
  if (cache.codes !== undefined) return cache.codes;
  try {
    const r = await x.get("Accounts");
    cache.codes = new Map((r.Accounts || []).map(a => [a.AccountID, { code: String(a.Code || ""), reportingCode: a.ReportingCode || "", system: a.SystemAccount || "", name: a.Name }]));
  } catch { cache.codes = null; }
  return cache.codes;
}

const pl = async (x, cache, from, to) => {
  const k = `pl:${from}:${to}`;
  if (!cache[k]) cache[k] = profitAndLoss(await x.get("Reports/ProfitAndLoss", { fromDate: from, toDate: to }));
  return cache[k];
};

/** All four measurables for one week. x = xero session; cache shared across the run. */
async function collectWeek(week, cache, now = new Date()) {
  const x = cache.xero;
  const s = cache.xeroSettings || (cache.xeroSettings = await settings());
  const today = time.sydneyDate(now);
  const day = [time.addDays(week, 6), today].sort()[0];
  const out = {};

  const bank = cashFrom(await x.get("Reports/BankSummary", { fromDate: day, toDate: day }));
  out["xero.cash"] = { value: bank.value, detail: { text: `Closing balance of ${bank.accounts} bank account${bank.accounts === 1 ? "" : "s"} on ${day}: ${money(bank.value)}.` } };

  const accounts = await reportingCodes(x, cache);
  const ar = receivablesFrom(await x.get("Reports/BalanceSheet", { date: day }), accounts);
  const last91 = await pl(x, cache, time.addDays(day, -90), day);
  const withGst = last91.revenue * (1 + s.gst);
  out["xero.dso"] = !ar.names.length
    ? { value: null, detail: { text: "Pulse couldn't find accounts receivable on Xero's balance sheet." } }
    : withGst > 0
      ? { value: r1((ar.value / withGst) * 91), detail: { text: `Receivables ${money(ar.value)} (${ar.names.join(", ")}) ÷ the last 91 days' revenue ${money(last91.revenue)} plus ${Math.round(s.gst * 100)}% GST, × 91.` } }
      : { value: null, detail: { text: "No revenue in the last 91 days." } };

  // SGM and EBITDA % are monthly: each week shows the latest whole month that had ended by the end of
  // the week (a part month misleads, because wages and depreciation are posted later in the month).
  // Provisional for 20 days after the month ends, while Finance closes it (D5).
  const monthStart = time.addMonths(day.slice(0, 8) + "01", time.addDays(day, 1).slice(8) === "01" ? 0 : -1);
  const monthEnd = time.addDays(time.addMonths(monthStart, 1), -1);
  const provisional = time.addDays(monthEnd, 20) > today;
  const label = `${new Date(monthStart + "T00:00:00Z").toLocaleString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" })}${provisional ? ", provisional until Finance closes the month" : ""}`;
  const month = await pl(x, cache, monthStart, monthEnd);
  const sgm = servicesMargin(month, accounts, s.sgmRevenue, s.sgmCost, s.sgmAccounts);
  out["xero.sgm"] = { value: sgm.value, provisional, detail: { text: `${sgm.text} ${label}.` } };
  const e = ebitda(month);
  out["xero.ebitda_pct"] = month.revenue
    ? { value: r1((100 * e.value) / month.revenue), provisional, detail: { text: `EBITDA ${money(e.value)} (net profit ${money(month.net)}${e.addBack.length ? ` plus ${e.addBack.join(", ")}` : ""}${e.interestIncome.length ? ` less ${e.interestIncome.join(", ")}` : ""}) of revenue ${money(month.revenue)}, ${label}.` } }
    : { value: null, provisional, detail: { text: `No revenue in ${label}.` } };
  return out;
}

/** FY plan revenue for a month (trading income), to `last` (end of month or today). */
async function revenueFor(month, last, cache) {
  const p = await pl(cache.xero, cache, month, last);
  return { value: Math.round(p.revenue * 100) / 100, detail: { text: `Trading income ${money(p.revenue)} from ${month} to ${last}.` } };
}

module.exports = { collectWeek, revenueFor, parseReport, profitAndLoss, ebitda, servicesMargin, cashFrom, receivablesFrom };
