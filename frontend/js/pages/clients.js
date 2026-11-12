// Client health (0.10.0, D23): the Account Manager's Early Warning for client churn, from SimpleSAT
// CSAT and NPS and Autotask tickets, with the happiest and least happy clients.
import { api } from "../api.js";
import { esc, icon, toast, fmtShort, fmtDateTime, fmtDate } from "../ui.js";
import { money, empty, dialog } from "../components.js";

const LEVEL = { risk: ["alert", "At risk"], watch: ["scheduled", "Watch"], healthy: ["ok", "Healthy"] };
const levelChip = l => { const [c, t] = LEVEL[l] || ["quiet", l]; return `<span class="chip ${c}">${t}</span>`; };
const KIND_ICON = { feedback: "star", tickets: "service-desk", contract: "calendar", sentiment: "ai" };

function meter(score, level) {
  return `<span class="risk-meter ${esc(level)}" role="img" aria-label="Early Warning score ${score} of 100"><span style="width:${Math.max(3, Math.min(100, score))}%"></span></span>`;
}
const npsText = n => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n}`);
const pctText = p => (p === null || p === undefined ? "—" : `${Math.round(p)}%`);
function change(c) {
  if (c === null || c === undefined) return `<span class="dim small">new</span>`;
  if (c === 0) return `<span class="dim small">no change</span>`;
  return `<span class="trend ${c > 0 ? "up" : "down"}" title="Since four weeks ago">${c > 0 ? "▲" : "▼"} ${Math.abs(c)}</span>`;
}
function happyBar(h) {
  return `<span class="happy-bar" role="img" aria-label="Happiness ${Math.round(h)} of 100"><span style="width:${Math.max(2, Math.min(100, h))}%"></span></span>`;
}

/* ---------------- the list ---------------- */
export async function clientsPage(me, id, q = {}) {
  if (!me.access.viewClients) return { title: "Client health", html: `<div class="note alert">${icon("vulnerability")}<span>Client health is for Leadership, Sales & Marketing and Managed Services.</span></div>` };
  if (id) return clientPage(me, id);
  const owner = q.owner || "";
  const d = await api(`/clients${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`);
  const s = d.summary, level = q.level || "all", find = String(q.find || "").toLowerCase();
  const shown = d.clients.filter(c => (level === "all" || c.level === level) && (!find || c.name.toLowerCase().includes(find)));
  const ownerOpts = [["me", "My clients"], ["all", "All clients"], ...d.owners.filter(o => !o.isMe).map(o => [o.email, `${o.name} (${o.clients})`])];
  const mrrCol = d.canSeeMrr;
  const run = d.lastRun;

  const rows = shown.map(c => `<tr class="click" data-href="#/clients/${c.id}">
      <td><a href="#/clients/${c.id}"><b>${esc(c.name)}</b></a>${c.issue ? `<div><a class="chip progress" href="#/issues" title="${esc(c.issue.title)}">Issue open</a></div>` : ""}</td>
      <td class="nowrap">${c.owner ? esc(c.owner.name) + (c.owner.isMe ? ` <span class="dim small">(you)</span>` : "") : `<span class="dim">No Account Manager</span>`}</td>
      <td class="nowrap"><div class="score-cell">${meter(c.score, c.level)}<b>${c.score}</b>${levelChip(c.level)}</div><div class="small">${change(c.change)}</div></td>
      <td class="why-col">${c.reasons.length ? `<ul class="why">${c.reasons.slice(0, 2).map(r => `<li>${icon(KIND_ICON[r.kind] || "discover", "i-sm")}<span>${esc(r.text)}</span></li>`).join("")}</ul>${c.reasons.length > 2 ? `<span class="dim small">and ${c.reasons.length - 2} more</span>` : ""}` : `<span class="dim small">No warning signs</span>`}</td>
      <td class="nowrap num">${c.csatN ? `${pctText(c.csatPct)} <span class="dim small">of ${c.csatN}</span>` : "—"}</td>
      <td class="nowrap num">${c.npsN ? `${npsText(c.nps)} <span class="dim small">of ${c.npsN}</span>` : "—"}</td>
      <td class="nowrap num">${c.tickets.last30}${c.tickets.slaMissed30 ? ` <span class="chip alert" title="SLAs missed in 30 days">${c.tickets.slaMissed30} SLA</span>` : ""}</td>
      ${mrrCol ? `<td class="nowrap num">${c.mrr === null || c.mrr === undefined ? "—" : money(c.mrr)}</td>` : ""}
    </tr>`).join("");

  const board = (list, kind) => list.length ? `<ol class="board">${list.map((c, i) => `<li>
      <span class="rank">${i + 1}</span>
      <a href="#/clients/${c.id}" class="board-name"><b>${esc(c.name)}</b><span class="dim small">${c.ratings} rating${c.ratings === 1 ? "" : "s"} · CSAT ${pctText(c.csatPct)} · NPS ${npsText(c.nps)}</span></a>
      <span class="board-score">${happyBar(c.happiness)}<b>${Math.round(c.happiness)}</b></span></li>`).join("")}</ol>`
    : empty(kind === "happy" ? "No client has 3 or more ratings yet." : "Not enough rated clients yet to fill both boards.");

  return {
    title: "Client health",
    html: `<section class="hero">
        <span class="hd-eyebrow">Account Manager</span>
        <h1>Client health and Early Warning</h1>
        <p>Every client on a recurring contract, scored for churn risk from their SimpleSAT CSAT and NPS and their Autotask tickets. Each score shows its reasons, so you know who to call and why.</p>
        <div class="hero-stats">
          <div><div class="k">At risk</div><div class="v">${s.risk}</div><div class="s">of ${s.clients} clients</div></div>
          <div><div class="k">Watch</div><div class="v">${s.watch}</div><div class="s">score 25–49</div></div>
          ${mrrCol ? `<div><div class="k">MRR at risk</div><div class="v">${money(s.mrrAtRisk)}</div><div class="s">a month</div></div>` : ""}
          <div><div class="k">CSAT, 90 days</div><div class="v">${s.csat ? pctText(s.csat.pct) : "—"}</div><div class="s">${s.csat ? `${s.csat.n} ratings` : "no ratings"}</div></div>
          <div><div class="k">NPS, 180 days</div><div class="v">${s.nps ? npsText(s.nps.score) : "—"}</div><div class="s">${s.nps ? `${s.nps.n} ratings` : "no ratings"}</div></div>
        </div>
      </section>

      <form class="filters" id="cl-filters">
        <label>Clients<select name="owner">${ownerOpts.map(([v, t]) => `<option value="${esc(v)}" ${v === d.owner ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
        <label>Show<select name="level">${[["all", "Everyone"], ["risk", "At risk"], ["watch", "Watch"], ["healthy", "Healthy"]].map(([v, t]) => `<option value="${v}" ${v === level ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Find<input name="find" type="search" value="${esc(q.find || "")}" placeholder="Client name"></label>
        <span class="spacer"></span>
        <div class="run-line small dim">${run ? `${run.ok === false ? `<span class="chip alert">Last run failed</span> ` : ""}Worked out ${esc(fmtDateTime(run.at))}` : "Not worked out yet"}
          <button class="btn outline sm" type="button" id="cl-refresh">${icon("momentum", "i-sm")}Work it out again</button></div>
      </form>

      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Early Warning</span><h2>${level === "all" ? "Who needs a call" : esc(LEVEL[level][1])}</h2></div>
          <span class="aside">${shown.length} client${shown.length === 1 ? "" : "s"}, highest risk first</span></div>
        ${shown.length ? `<div class="tbl-wrap"><table class="clients">
          <thead><tr><th>Client</th><th>Account Manager</th><th>Score</th><th>Why</th><th>CSAT, year</th><th>NPS, year</th><th>Tickets, 30 days</th>${mrrCol ? "<th>MRR</th>" : ""}</tr></thead>
          <tbody>${rows}</tbody></table></div>` : empty(d.clients.length ? "No clients match." : d.owner === "me" ? "You're not the Account Manager on any client in Autotask. Choose All clients to see everyone." : "No clients yet. They appear after the first nightly run.")}
      </section>

      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Leaderboard</span><h2>Happiest and least happy clients</h2></div>
          <span class="aside">${d.leaderboards.ranked} clients with ${d.leaderboards.minRatings}+ ratings in the last year</span></div>
        <div class="two-col">
          <div class="panel tight"><h3>${icon("star", "i-sm")} Happiest</h3>${board(d.leaderboards.happiest, "happy")}</div>
          <div class="panel tight"><h3>${icon("vulnerability", "i-sm")} Least happy</h3>${board(d.leaderboards.unhappiest, "unhappy")}</div>
        </div>
        <p class="dim small">Happiness is every CSAT and NPS rating in the last year on a 0–100 scale (CSAT happy 100, neutral 50, unhappy 0; NPS × 10). A rating from four months ago counts half as much as one from today.</p>
      </section>

      <section class="sec"><details class="how"><summary><b>How the Early Warning score works</b></summary>
        <div class="two-col">
          <div><h3>Feedback (SimpleSAT)</h3><ul>
            <li>Latest NPS in 180 days is a detractor (0–6): <b>+30</b>; passive (7–8): <b>+10</b></li>
            <li>Each unhappy CSAT in 90 days: <b>+12</b> (up to 36); each neutral: <b>+4</b> (up to 12)</li>
            <li>CSAT in 90 days 15+ points below the year before: <b>+10</b></li>
            <li>Gone quiet: answered surveys before, none in 120 days, still raising tickets: <b>+5</b></li></ul></div>
          <div><h3>Tickets and contract (Autotask)</h3><ul>
            <li>Ticket spike: 8+ in 30 days, double the month before and 5 more than it: <b>+15</b></li>
            <li>Each SLA missed in 30 days: <b>+5</b> (up to 15); each Critical ticket: <b>+5</b> (up to 10)</li>
            <li>Tickets open more than 14 days: 3–5 <b>+5</b>, 6 or more <b>+10</b></li>
            <li class="dim">Only tickets the client raised count: Autotask alerts and monitoring tickets are left out.</li>
            <li>Recurring contract ends within 30 days <b>+20</b>, within 90 days <b>+15</b></li></ul>
            <h3>How they sound in their tickets (Azure OpenAI)</h3><ul>
            <li>A ticket in 90 days talks about leaving, cancelling or changing provider: <b>+30</b></li>
            <li>Each ticket in 30 days where the client sounded frustrated: <b>+6</b> (up to 18)</li></ul></div>
        </div>
        <p><span class="chip ok">Healthy</span> 0–24 · <span class="chip scheduled">Watch</span> 25–49 · <span class="chip alert">At risk</span> 50 and over. Account Managers get a Teams alert when one of their clients moves into At risk.</p>
        <p class="dim small">Feedback is matched to the client through the Autotask ticket it was about.</p>
        ${sentimentNote(d.sentiment)}
      </details></section>`,
    mount(root, refresh) {
      const f = root.querySelector("#cl-filters");
      const go = () => {
        const p = new URLSearchParams();
        p.set("owner", f.owner.value);
        if (f.level.value !== "all") p.set("level", f.level.value);
        if (f.find.value.trim()) p.set("find", f.find.value.trim());
        location.hash = "#/clients" + (p.toString() ? "?" + p : "");
      };
      f.owner.onchange = go; f.level.onchange = go;
      f.onsubmit = e => { e.preventDefault(); go(); };
      let t = null; f.find.oninput = () => { clearTimeout(t); t = setTimeout(go, 500); };
      root.querySelector("#cl-refresh").onclick = async () => {
        try { await api("/clients/refresh", { method: "POST", body: {} }); toast("Asked for: the scores update within about 15 minutes"); } catch (e) { toast(e.message); }
      };
      const sw = root.querySelector("#cl-sentiment");
      if (sw) sw.onclick = () => dialog({
        title: d.sentiment.enabled ? "Switch off ticket sentiment" : "Switch on ticket sentiment",
        intro: d.sentiment.enabled ? "Pulse stops sending ticket text to Azure OpenAI. Results already worked out stay until they age out (120 days)." : "Pulse starts reading client-visible ticket text with Azure OpenAI in Australia East again.",
        fields: [{ name: "reason", label: "Reason (kept in the audit log)", type: "textarea", required: true, rows: 2 }],
        submit: d.sentiment.enabled ? "Switch off" : "Switch on", danger: d.sentiment.enabled,
        onSubmit: async v => { await api("/clients/sentiment", { method: "PUT", body: { enabled: !d.sentiment.enabled, reason: v.reason } }); toast("Saved"); refresh(); },
      });
      root.querySelectorAll("tr.click").forEach(tr => { tr.onclick = e => { if (!e.target.closest("a")) location.hash = tr.dataset.href; }; });
    },
  };
}

function sentimentNote(st) {
  if (!st) return "";
  const state = !st.enabled ? `<span class="chip quiet">Switched off</span>` : st.analysed30 ? `<span class="chip ok">On</span>` : `<span class="chip scheduled">Not running yet</span>`;
  return `<div class="note info small">${icon("ai")}<span><b>Ticket sentiment</b> ${state}
    Azure OpenAI${st.model ? ` (${esc(st.model)})` : ""} in Australia East reads the text the client can see on tickets they raised: the title, the description and notes that aren't internal, with email addresses and phone numbers taken out. Only its verdict is kept, never the ticket text. ${st.analysed30 ? `${st.analysed30} tickets from the last 30 days read.` : ""}
    ${st.canSwitch ? `<button class="btn outline sm" type="button" id="cl-sentiment">${st.enabled ? "Switch off" : "Switch on"}</button>` : ""}</span></div>`;
}

/* ---------------- one client ---------------- */
function sparkline(history) {
  if (history.length < 2) return `<p class="dim small">The trend appears after a second week.</p>`;
  const w = 320, h = 80, pad = 6, n = history.length;
  const x = i => pad + (i * (w - 2 * pad)) / (n - 1), y = v => h - pad - (Math.max(0, Math.min(100, v)) * (h - 2 * pad)) / 100;
  const pts = history.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const band = (from, to, cls) => `<rect class="${cls}" x="${pad}" width="${w - 2 * pad}" y="${y(to)}" height="${y(from) - y(to)}"/>`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Early Warning score over ${n} weeks: ${history.map(p => p.score).join(", ")}">
    ${band(50, 100, "b-risk")}${band(25, 50, "b-watch")}
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${history.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.score)}" r="3"><title>Week of ${fmtShort(p.week)}: ${p.score}</title></circle>`).join("")}
  </svg><div class="dim small spark-axis"><span>${esc(fmtShort(history[0].week))}</span><span>this week</span></div>`;
}

function ratingChip(f) {
  if (f.metric === "nps") {
    const k = f.rating === null ? "quiet" : f.rating >= 9 ? "ok" : f.rating <= 6 ? "alert" : "scheduled";
    return `<span class="chip ${k}">NPS ${f.rating ?? "—"}</span>`;
  }
  const s = f.sentiment || (f.rating >= 4 ? "positive" : f.rating <= 2 ? "negative" : "neutral");
  return `<span class="chip ${s === "positive" ? "ok" : s === "negative" ? "alert" : "scheduled"}">CSAT ${f.rating ?? ""}${f.rating ? "/5" : ""} · ${s === "positive" ? "happy" : s === "negative" ? "unhappy" : "neutral"}</span>`;
}

async function clientPage(me, id) {
  const c = await api(`/clients/${encodeURIComponent(id)}`);
  const t = c.tickets;
  const kpi = (k, v, sub = "", off = false) => `<div class="kpi ${off ? "off" : ""}"><span class="k">${esc(k)}</span><b>${v}</b>${sub ? `<span class="dim small">${sub}</span>` : ""}</div>`;
  const openIssue = c.issues.find(i => i.status === "open");
  return {
    title: c.name,
    html: `<a class="back" href="#/clients">${icon("arrow-right", "i-sm flip")} Client health</a>
      <div class="ph"><span class="hd-eyebrow">Client health</span><h1>${esc(c.name)}</h1>
        <p>${c.owner ? `Account Manager: <b>${esc(c.owner.name)}</b>` : "No Account Manager set in Autotask"} · worked out ${esc(fmtDateTime(c.computedAt))}</p>
        <div class="ph-act">
          <a class="btn outline" href="${esc(c.autotaskUrl)}" target="_blank" rel="noopener">${icon("external", "i-sm")}Open in Autotask</a>
          ${openIssue ? `<a class="btn outline" href="#/issues">${icon("discover", "i-sm")}Issue open: ${esc(openIssue.title)}</a>` : `<button class="btn outline" type="button" id="cl-issue">${icon("discover", "i-sm")}Raise an Issue</button>`}
          <button class="btn" type="button" id="cl-note">${icon("check", "i-sm")}Log a follow-up</button>
        </div></div>

      <div class="kpis">
        ${kpi("Early Warning", `${c.score} ${levelChip(c.level)}`, "out of 100", c.level === "risk")}
        ${kpi("Happiness", c.happiness === null ? "—" : Math.round(c.happiness), c.ratings ? `${c.ratings} ratings in the year${c.ranked ? "" : " (needs 3 to rank)"}` : "no ratings in the year")}
        ${kpi("CSAT, year", pctText(c.csatPct), c.csatN ? `${c.csatN} ratings` : "no ratings")}
        ${kpi("NPS, year", npsText(c.nps), c.npsN ? `${c.npsN} ratings` : "no ratings")}
        ${kpi("Tickets, 30 days", t.last30, `about ${Math.round(t.monthBefore)} a month before`)}
        ${kpi("SLAs missed, 30 days", t.slaMissed30, "", t.slaMissed30 > 0)}
        ${kpi("Open over 14 days", t.agedOpen, "", t.agedOpen >= 3)}
        ${c.mrr !== undefined ? kpi("MRR", c.mrr === null ? "—" : money(c.mrr), c.seats ? `${c.seats} seats` : "") : ""}
        ${kpi("Contract ends", c.contractEnd ? esc(fmtDate(c.contractEnd)) : "—", "soonest recurring contract")}
      </div>

      <div class="two-col sec">
        <div class="panel tight"><h3>Why this score</h3>
          ${c.reasons.length ? `<ul class="why big">${c.reasons.map(r => `<li>${icon(KIND_ICON[r.kind] || "discover", "i-sm")}<span>${esc(r.text)}</span><b class="pts">+${r.points}</b></li>`).join("")}</ul>` : `<p>No warning signs right now.</p>`}
        </div>
        <div class="panel tight"><h3>Last 13 weeks</h3>${sparkline(c.history)}</div>
      </div>

      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">SimpleSAT</span><h2>What they've told us</h2></div><span class="aside">Last 12 months, newest first</span></div>
        ${c.feedback.length ? `<ul class="fb-list">${c.feedback.map(f => `<li class="${f.sentiment === "negative" || (f.metric === "nps" && f.rating !== null && f.rating <= 6) ? "neg" : ""}">
            <div class="fb-h">${ratingChip(f)} <span class="dim small">${esc(fmtDateTime(f.at))}</span>
              ${f.ticketNumber ? `<span class="dim small">· ticket ${esc(f.ticketNumber)}${f.ticketSubject ? `: ${esc(f.ticketSubject)}` : ""}</span>` : ""}</div>
            ${f.comment ? `<blockquote>${esc(f.comment)}</blockquote>` : ""}
            <div class="dim small">${f.contactName ? esc(f.contactName) : "Contact not named"}${f.teamMember ? ` · handled by ${esc(f.teamMember)}` : ""}${f.topics ? ` · topics: ${esc(f.topics)}` : ""}</div>
          </li>`).join("")}</ul>` : empty("No CSAT or NPS ratings from this client in the last year.")}
      </section>

      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Azure OpenAI</span><h2>How they sound in their tickets</h2></div>
          <span class="aside">${c.ticketMoods.analysed ? `${c.ticketMoods.analysed} tickets in 90 days read: ${c.ticketMoods.negative} negative, ${c.ticketMoods.positive} positive` : "Last 90 days"}</span></div>
        ${c.ticketMoods.list.length ? `<ul class="fb-list">${c.ticketMoods.list.map(m => `<li class="${m.churn || m.frustration >= 2 ? "neg" : ""}">
            <div class="fb-h">${m.churn ? `<span class="chip alert">Talks about leaving</span>` : ""}${m.frustration >= 2 ? `<span class="chip alert">Frustrated${m.frustration === 3 ? ", strongly" : ""}</span>` : ""}
              ${m.sentiment === "negative" && !m.churn && m.frustration < 2 ? `<span class="chip scheduled">Negative</span>` : ""}
              <a class="small" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.ticketNumber || "Ticket")}</a> <span class="dim small">${esc(fmtShort(m.at))}${m.title ? ` · ${esc(m.title)}` : ""}</span></div>
            ${m.reason ? `<div>${esc(m.reason)}</div>` : ""}</li>`).join("")}</ul>`
          : empty(c.ticketMoods.analysed ? "Nothing negative in their tickets in the last 90 days." : "No tickets read yet for this client.")}
        <p class="dim small">Read by Azure OpenAI from the text the client can see on their tickets. It can be wrong: open the ticket before acting on it.</p>
      </section>

      <section class="sec"><div class="sec-h"><div><span class="hd-eyebrow">Follow-up</span><h2>Notes</h2></div></div>
        ${c.notes.length ? `<ul class="plain">${c.notes.map(n => `<li><div>${esc(n.note)}</div><div class="dim small">${esc(n.by)} · ${esc(fmtDateTime(n.at))}</div></li>`).join("")}</ul>` : empty("No follow-ups logged yet.")}
        ${c.issues.length ? `<h3 class="small-h">Issues raised</h3><ul class="plain">${c.issues.map(i => `<li><a href="#/issues">${esc(i.title)}</a> <span class="chip ${i.status === "open" ? "progress" : "quiet"}">${esc(i.status)}</span></li>`).join("")}</ul>` : ""}
      </section>`,
    mount(root, refresh) {
      root.querySelector("#cl-note").onclick = () => dialog({
        title: `Follow-up with ${c.name}`, intro: "What happened and what's next. Everyone who can see Client health can read it.",
        fields: [{ name: "note", label: "Note", type: "textarea", required: true }], submit: "Save",
        onSubmit: async v => { await api(`/clients/${c.id}/notes`, { method: "POST", body: { note: v.note } }); toast("Saved"); refresh(); },
      });
      const ib = root.querySelector("#cl-issue");
      if (ib) ib.onclick = () => dialog({
        title: "Raise an Issue", intro: `It goes on ${me.access.leadership || (me.access.ownDivisions || []).includes("SalesMarketing") ? "the Sales & Marketing" : "your division's"} Issues List for IDS, with the score's reasons in the description.`,
        fields: [
          { name: "title", label: "Issue", value: `${c.name}: client at risk`, required: true },
          ...(me.access.leadership ? [{ name: "level", label: "List", type: "select", value: "division", options: [{ v: "division", t: "Sales & Marketing" }, { v: "company", t: "Company (leadership team)" }] }] : []),
        ],
        submit: "Raise it",
        onSubmit: async v => {
          const own = me.access.ownDivisions || [];
          const division = me.access.leadership || own.includes("SalesMarketing") ? "SalesMarketing" : own[0] || "SalesMarketing";
          await api(`/clients/${c.id}/issue`, { method: "POST", body: { title: v.title, level: v.level || "division", division } });
          toast("Added to the Issues List"); refresh();
        },
      });
    },
  };
}
