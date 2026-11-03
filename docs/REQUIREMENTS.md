# HD IT Pulse — requirements (living document)

Built up one decision at a time with George, starting 30 October 2026. Each decision records what was agreed and why. Open questions are at the end.

## Purpose
Give each division the insights and tools to run efficiently and optimally, grounded in EOS, Evolve/Service Leadership Index (SLI) benchmarking and Evergreen guidance. Focus on the important numbers only: no information overload.

## Inputs used
- EOS V/TO (Aug 2026): 3-year picture and 1-year plan measurables (Revenue, Profit, MRR, Seats, New Seats, NPS, ESAT, SGM, OML).
- Accountability Chart (19 Aug 2026) and Org Chart (21 Aug 2026), in the project's files: five seats under the Integrator (Finance & Accounts, HR, Sales & Marketing, Innovation & Compliance, Managed Services), each with sub-seats, roles and key results. Loaded into Pulse as 23 seats (D18).
- SLI Company Dashboard Q2 2026 (HD IT = "Parramatta") and Group Index Q3 2026.
- Xero chart of accounts (already tagged with SLI codes, e.g. PR1, CL1, I22, C12, E1s) and P&L.
- Evergreen Elevate26: Golden Scorecard (controllable scorecards per role), P&L Management (price, cost, new business).
- HD IT Brand System V5.0.
- Strety feature set as the EOS tooling reference.

## Constraints and principles (from the brief)
- SSO with Microsoft Entra ID is mandatory.
- Security and compliance are paramount: ISO 27001 and ISO 9001 certified.
- Prefer no Azure database to manage; acceptable if essential.
- Reuse Pipeline, Marketing ROI and Whitespace Matrix as they are, made a seamless part of Pulse.
- Core systems: Autotask, Datto RMM, Kaseya Quote Manager, Xero, SimpleSAT, CIPP, SharePoint Online, Planner, Exchange Online, Teams, IT Glue.
- Central management of API credentials, with credentials segmented by what each API user can access (one full-access user per system acceptable only if access is controlled carefully).
- Best-practice documentation: user guide, FAQ, release notes (what's new) by version, and plain-English explanations of every key metric and calculation.

## Decisions

### D1. Pulse is HD IT's EOS system (30 Oct 2026)
Pulse replaces the current EOS tool and is the system of record for Scorecard, Rocks, Issues, To-dos, Level 10 meetings, V/TO and the Accountability Chart. People tools (People Analyzer, Quarterly Conversations, 1:1s) follow in a later phase because they hold sensitive HR data.

Scorecard values fill in automatically from source systems where a source exists, and **any automatic value can be overridden with a mandatory reason**. Agreed rules:
- Leadership can override any measurable; everyone else only their own division's measurables (see Confirmed before build, item 3).
- The automatic value is kept alongside the override; both are visible, and the cell is marked as overridden.
- Every override and change is recorded in an audit trail (who, when, old value, new value, reason).
- An override applies to that week only; later weeks keep filling in automatically.
- An override can be reverted to the automatic value, with a reason.

Consequence: people write into Pulse weekly, so Pulse needs a durable data store with history and an audit trail (see open question on data store).

### D2. First release: Leadership and EOS core (30 Oct 2026)
Release 1 delivers the company Scorecard, Rocks, Issues, To-dos, the weekly L10 meeting run inside Pulse, and the V/TO, with Pipeline, Marketing ROI and Whitespace Matrix available inside Pulse from day one. The first automatically filled measurables are the Managed Services and finance ones (the biggest SLI gaps). Every later division plugs into the same Scorecard pattern.

### D3. Visibility: open within the leadership team (30 Oct 2026)
Sections follow the Accountability Chart: Leadership (Visionary, Integrator), Finance & Accounts, People (HR), Sales & Marketing (Marketing, Business Development, Sales Admin, Account Management), Innovation & Compliance (DevOps, Compliance), Managed Services (Service Team, Projects, Client Success, Service Admin, NOC). Access comes from Entra security groups mapped to seats (least privilege; quarterly access review for ISO 27001).
- Leadership-seat holders see every division.
- Staff see their own division in full, plus company-wide items: V/TO, company Rocks and the company Scorecard, without detailed financials.
- Full P&L detail, wages and per-client profitability: Finance, Visionary and Integrator only.
- People (HR) data: HR and the person's own manager only.

### D4. Company Scorecard, starting list (30 Oct 2026)
Starting list of 15 measurables; goals marked "set with owner" are refined by each owner in Pulse.

| # | Measurable | Owner | Goal | Source | Frequency |
|---|---|---|---|---|---|
| 1 | MQLs | Faben Miglani | ≥ 7 a week (30 a month) | Autotask (Marketing ROI) | Weekly |
| 2 | New MRR signed | Faben Miglani | Pace to $560K MRR | Autotask | Weekly |
| 3 | Weighted pipeline (Stages 6–7) | Faben Miglani | Set with owner | Autotask (Pipeline) | Weekly |
| 4 | New seats signed | Faben Miglani | ≥ 12.5 a week (650 a year) | Autotask contracts | Weekly |
| 5 | Seats serviced | Tony Parzakonis | ≥ 2,350 | Autotask contracts / Datto RMM | Weekly |
| 6 | SLA first response met | Tony Parzakonis | ≥ 95% | Autotask | Weekly |
| 7 | Tickets closed per tech per day | Tony Parzakonis | Set with owner (Evergreen benchmark 10) | Autotask (techs = default department Service Desk, D16) | Weekly |
| 8 | First-contact resolution | Tony Parzakonis | Set with owner | Autotask | Weekly |
| 9 | Billable utilisation | Tony Parzakonis | Set with owner | Autotask time entries (techs, D16) | Weekly |
| 10 | CSAT | Tony Parzakonis | Set with owner | SimpleSAT | Weekly |
| 11 | NPS (last 90 days) | Tony Parzakonis | ≥ +65 | SimpleSAT | Weekly |
| 12 | Cash on hand | Mandy Moujalli | Set with owner | Xero | Weekly |
| 13 | Debtor days (DSO) | Mandy Moujalli | ≤ 28 | Xero | Weekly |
| 14 | Services gross margin (SGM) | Mandy Moujalli | ≥ 45% | Xero (SLI codes) | Monthly, shown weekly |
| 15 | EBITDA % (Profit) | Mandy Moujalli | ≥ 11% | Xero (SLI codes) | Monthly, shown weekly |

Kept on division scorecards (roll up when red): patch and backup compliance, project budget, open ISO corrective actions, ESAT (quarterly), OML (quarterly).

Definitions confirmed:
- **SGM** = SLI F18 Services Gross Margin.
- **Profit** = SLI IS4 EBITDA as a % of revenue (not Adjusted EBITDA). HD IT rolling 4 quarters 11.8%; industry 10.5%; best in class 20.7%.
- **OML** = SLI Operational Maturity Level.

### D5. Scorecard week, locking and freshness (30 Oct 2026)
- Leadership L10: **Tuesdays 9:30am** (Sydney).
- Scorecard week: Monday to Sunday, Australia/Sydney. Tuesday's L10 reviews the week just ended.
- The week fills in automatically and keeps updating until it locks.
- **Lock:** 5pm Tuesday (Sydney). After locking, changes are overrides with a reason (D1).
- Monthly measurables (SGM, EBITDA %) fill in from Xero and show as *provisional* until Finance marks the month closed.
- Freshness: company Scorecard hourly; operational views (e.g. service desk queues) every 15 minutes when those divisions are built.

### D6. Data store: Azure SQL Database, fixed-price tiers (30 Oct 2026)
- Pulse's own data (EOS items, weekly Scorecard snapshots, overrides, audit trail) lives in Azure SQL Database.
- **Production: Standard S0** (10 DTU, 250 GB, backups up to 35 days), about A$25/month. Step up to S1 (about A$50) if needed.
- **Test: Basic** (5 DTU, 2 GB), about A$8/month.
- Always on (no wake-up delay). Entra ID-only authentication via Pulse's managed identity (no SQL passwords). Encryption at rest, automatic backups and point-in-time restore.
- System-versioned (temporal) tables provide the change history for the ISO audit trail.
- Consider long-term backup retention (e.g. monthly backups kept 12 months) for ISO; a few dollars a month.
- Serverless was rejected: hourly updates and daytime use keep it awake (about A$90–170/month) and it has a 30–60 second wake-up delay.
- Prices are estimates from US list prices; confirm in the Azure pricing calculator before building.
- Documents (process playbooks, ISO evidence) stay in SharePoint, linked from Pulse. Pipeline, Marketing ROI and Whitespace keep their Table Storage for now.

### D7. API credentials: one central vault, separate API users per area (30 Oct 2026)
- All integration credentials live in one Pulse Key Vault: Autotask, Xero, Datto RMM, SimpleSAT, IT Glue, CIPP, Microsoft Graph (SharePoint, Planner, Exchange, Teams) and Kaseya Quote Manager.
- **Separate API users per area** with least privilege, e.g. Autotask: Sales (opportunities, quotes, companies), Service (tickets, projects, time entries), Finance (contracts, billing). Read-only wherever possible; write access only where Pulse changes something.
- Each Pulse module's identity can read only its own secrets (Key Vault RBAC at secret scope), so one compromised component can't reach every credential.
- **Connections** page for Platform Admins: status, last successful use, owner, expiry, rotation due. Credentials are write-only (entered or rotated, never displayed). Every change logged. **Credential entry moved forward to 0.5.1 (3 Nov 2026)** so credentials are typed into Pulse rather than Cloud Shell; Autotask credentials are tested before saving.
- Each source system's own audit log shows which Pulse area acted.

### D8. Security baseline and sign-in policy (30 Oct 2026)
**Sign-in: strict.** MFA **and** an Intune-compliant (managed) device for everyone, from any location, including offshore NOC staff. No personal devices. Enforced by a Conditional Access policy on the HD IT Pulse enterprise app. All staff, including offshore NOC, are confirmed on Intune-managed compliant devices.

Baseline controls (ISO 27001 practice):
- Audit log of every sign-in, change, override and view of sensitive pages (finance detail, People data). Kept 12 months in Azure. Viewable in Pulse by Platform Admins and Compliance.
- All data in Australia East. Only static website files are served from East Asia, with no data.
- Session expiry after inactivity.
- Platform Admin limited to two or three people. Quarterly access review exportable by Compliance.
- Change control: every change via GitHub with a version number and release notes, tested in the test environment before production. This is the change record for ISO 9001 and ISO 27001.
- Microsoft Defender for Cloud on the Azure resources. Annual penetration test recommended.

### D9. Existing apps: keep their engines, make them look and feel like Pulse (30 Oct 2026)
Pipeline, Marketing ROI and Whitespace Matrix keep their own backends, logic and Autotask API users. Inside Pulse they:
- drop their own headers and use Pulse's navigation, filters and account menu;
- move to HD IT Brand System V5.0 (the old teal styling is retired);
- move their user guides, FAQs and what's new into Pulse's help centre;
- feed Pulse their numbers (weighted pipeline from Pipeline, MQLs from Marketing ROI, whitespace dollars from Whitespace) for the Scorecard;
- open at the matching view when a Scorecard number is selected (e.g. Stage 6 deals).
Merging backends is not planned.

### D10. One identity per person, matched across systems by email (30 Oct 2026)
- The person's **Entra object ID** is the master identity. Pulse keeps a People directory (Azure SQL) linking each person to their account in every integrated system: Autotask resource ID, Datto RMM, IT Glue, SimpleSAT, Kaseya Quote Manager, and others as they are added.
- Matching is by email, case-insensitive, against **all** of the person's addresses from Entra (sign-in name, primary email and aliases), because some Autotask resources use a short alias (e.g. first-name@) rather than the sign-in address.
- Only active accounts that belong to people are considered; API, integration and shared-mailbox accounts are excluded. Exactly one match links automatically. No match, or more than one, goes to a **Needs review** list for Platform Admins.
- Refreshed nightly and at a person's first sign-in. New starters and leavers are flagged. Disabling someone in Entra removes Pulse access immediately.
- Platform Admins can set or change a link, with a reason (audited). People cannot pick their own Autotask identity in production; the "choose your name" step in the existing apps is replaced by the central directory.
- People with no account in a system (e.g. no Autotask resource) still use Pulse; features that write to that system aren't offered to them.
- **Built in 0.5.2 (3 Nov 2026):** Entra users (members, enabled, licensed) synced daily; Autotask resources every 15 minutes; matching by all of a person's Entra addresses against Autotask email, email2 and email3; admin links and "No Autotask account" override matching; the review list covers no match, multiple matches, conflicts, and Autotask accounts linked to nobody (for information).
- Initial check of the Autotask resource export (30 Oct 2026): 216 resources, 55 active, 24 active people (one, the built-in Autotask Administrator, has no email). Seven active people have mixed-case emails; one person has a duplicate inactive resource with the same email (the active one wins); several API resources share an email (never matched).

### D11. A few deliberate two-way links (30 Oct 2026)
- **To-dos** sync two-way with a "Pulse – L10" plan in Microsoft Planner, so they appear in Teams and Outlook; completing one in either place completes it in both. (Planner confirmed as the To-do home.)
- **Issues** can create an Autotask ticket or project task with one click, linked back to the Issue.
- **Scorecard:** a measurable off target two weeks running *suggests* an Issue for the next L10 (not created automatically).
- **Rocks** can link to a Planner plan or Autotask project so progress shows automatically.
- No broad write-back to source systems (tickets, contracts, Xero records stay edited in their own systems).

### D12. Teams first (30 Oct 2026)
- Pulse as a Teams app: personal app in each person's sidebar, and a tab in the leadership channel so the L10 can run from it during the Teams meeting. Same Entra sign-in and device rules as the web.
- Notifications from a Pulse bot in Teams chat, only what's each person's own:
  - Monday 8am: measurable owners reminded to check numbers and enter manual ones.
  - Tuesday 9am: L10 link to attendees with off-target measurables.
  - After the L10: each person's new To-dos.
  - Overdue To-dos: one reminder each.
  - Rocks marked off track: weekly nudge to the owner.
- Email: a weekly one-page summary only, which each person can switch off.
- L10 tab: General channel of the leadership team (see Confirmed before build, item 1).

### D13. Documentation: in Pulse only for now, ready to file to SharePoint later (30 Oct 2026)
- Every number has an ⓘ explanation: what it is and why it matters, the exact calculation with a worked example, source and update frequency, goal and SLI/Evergreen benchmark, and owner. Metric definitions are versioned, so past weeks show the definition in force at the time.
- In-app help centre: user guide, FAQ, metric glossary, in plain Australian English to Brand V5 voice rules.
- What's new: release notes by version, plus a banner after each update. The three apps' notes move into the same help centre.
- Technical documents for ISO: architecture and data flows, access-review procedure, backup/restore and disaster recovery, incident response, integration and credential register.
- **ISO document control: option B (in-app only)** for now. Built so option A can be switched on later without rework: help content is versioned with each release and can be exported to PDF; a release-approval step (e.g. by Compliance) and automatic filing to a SharePoint ISO document library can be added.

### D14. Hosting, environments and budget (30 Oct 2026)
| | Test | Production |
|---|---|---|
| Tenant | HD IT Testing Tenancy | Main HD IT tenant |
| Region | Australia East | Australia East |
| Address | `*.azurestaticapps.net` | **pulse.hdit.com.au** (free managed certificate) |
| Deploys | Automatically on every change | Only when a tested release is approved in GitHub |

Estimated monthly cost (AUD, list prices; confirm in the Azure pricing calculator before deploying):
- Production: Static Web App Standard ~14; Functions (Flex Consumption) 0–15; Azure SQL S0 ~25; Key Vault and storage ~5; monitoring and 12-month audit retention 5–20 → **~A$50–80**.
- **Microsoft Defender for Cloud included** (SQL and Function App): +A$40–60 → production **~A$90–140**.
- Test: ~A$20–30.
- Pipeline, Marketing ROI and Whitespace keep their own hosting (a few dollars to ~A$15 each). Marketing ROI and Whitespace get production environments alongside Pulse.

### D15. AI in release 2 (30 Oct 2026)
Release 1 builds the Scorecard and data foundations. Release 2 adds, once several weeks of trustworthy history exist:
- "Why did this number change?" next to each measurable, explaining the movement from underlying data.
- L10 summary with suggested To-dos from meeting notes.
- Ask Pulse: plain-English questions over Pulse data, limited to what the person can already see.
AI runs on Azure OpenAI hosted in Australia under HD IT's subscription; data is not used for training; every AI answer shows the numbers it used.

### D16. Autotask departments: view and change in Pulse, two-way (31 Oct 2026)
- A **tech** is any active Autotask resource whose **default department is "Service Desk"**. This defines who counts for tickets closed per tech per day and billable utilisation (D4 items 7 and 9), using the department in force during the week.
- Pulse shows the people in each Autotask default department (from the People directory, D10).
- Pulse can change the default department for one person or several at once. The change is written to Autotask (`ResourceRoleDepartments`: the chosen department-and-role pairing is set as default, created if the person doesn't have it yet; Autotask then clears the old default itself). Changes made in Autotask show in Pulse at the next sync (every 15 minutes, and on demand).
- Who can change departments: Platform Admins and Leadership. Every change records who, when, old and new department, and a reason, in the audit log; Autotask's own history shows the Pulse API user.
- Writing to Autotask uses a dedicated Autotask API user for people administration with only the resource permissions this needs, held in the central vault (D7).
- Department history is kept in Pulse so past weeks use the department in force at the time.
- **Built in 0.5.2 (3 Nov 2026):** People and departments page; multi-select change (up to 50 at a time); Pulse re-reads each changed person from Autotask to confirm. Uses the `autotask-people` credential.

### D17. Xero: live organisation, read-only, standard connection (31 Oct 2026)
- Test and production both read HD IT's **live Xero** organisation. The test tenancy therefore holds real finance figures; in test, finance detail is limited to the Finance Detail group, as in production.
- **Read-only**, enforced by Xero: Pulse asks only for granular `.read` scopes (profit and loss, balance sheet, bank summary, aged receivables, trial balance, settings for the chart of accounts and its reporting codes) plus `offline_access`. Pulse can't change anything in Xero.
- **Standard OAuth connection** (no Custom Connection fee). A Finance user connects Xero once from the Connections page. The refresh token is kept in Key Vault and renewed on every hourly run. If it lapses (60 days unused), the Connections page shows it and asks for a reconnect.

### D18. Navigation by division and role (3 Nov 2026)
Pulse is organised so each person can go straight to their division, and from there to their own seat.
- **Home (My Pulse):** your seat(s), your To-dos, your Rocks this quarter, the measurables you own, your divisions and your apps. Leadership and Finance also see the FY progress bars (D19) at the top.
- **Company:** Scorecard, Rocks, Issues (leadership team), To-dos, L10 meeting (0.7.0), V/TO, Accountability Chart, FY plan (Leadership and Finance).
- **Divisions:** Leadership sees all six; everyone else sees their own, first. Each division page shows its key result, its apps, its numbers on the company Scorecard and its seats, with tabs for the division's own Scorecard, Rocks, Issues and To-dos. While you're in a division, the menu lists its seats.
- **Seats (roles):** each seat from the Accountability Chart has a page with its roles, key result, who sits in it (grouped by team, e.g. Service Desk, Field Services, NOC), the measurables it owns, its Rocks, its apps, and a proposed role scorecard (Evergreen Golden Scorecard) to agree with the seat's owner and switch on in release 2.
- **Seats loaded from the charts:** 23 seats, their roles, key results and holders (with job titles and teams from the Org Chart). Leadership can edit seats, holders and each seat's apps in Pulse; every change is audited and versioned.
- **Apps by seat:** Pipeline (Head of Sales & Marketing, Business Development, Sales Administration, Account Management), Marketing ROI (Head of Sales & Marketing, Marketing, Business Development), Whitespace Matrix (Head of Sales & Marketing, Business Development, Account Management). Access to an app still comes from its Pulse group.
- Until the People directory (0.6.0) fills in emails, seat holders are matched to the signed-in person by name. Matching only decides what's shown as "yours"; permissions always come from Entra groups.
- **To confirm:** the Org Chart (21 Aug) shows the Head of Finance & Accounts, Head of Sales & Marketing and Head of Managed Services boxes blank, while the Accountability Chart (19 Aug) names Mandy Moujalli, Faben Miglani and Tony Parzakonis. Pulse uses the Accountability Chart. Seats with nobody named: Office Management, Projects Team Leadership, Client Success, Projects Teams, Marketing (Marketing Administrator vacant) and the BDM role.

### D19. FY progress bars for the leadership team (3 Nov 2026)
- The leadership home page shows progress to the V/TO 1-year plan for the Australian financial year **FY27 (1 July 2026 to 30 June 2027)**: Q1 Jul–Sep, Q2 Oct–Dec, Q3 Jan–Mar, Q4 Apr–Jun.
- Metrics: **Revenue ($9.2M)** and **New seats (650)** add up month by month; **MRR ($560K)** and **Seats (2,350)** are month-end levels, measured from where the year started (30 June) to the target.
- Each metric has a year bar and four quarter sub-bars. A tick shows how much of the year (or quarter) has gone, with an "On pace" or "Behind pace" label.
- **Quarter targets are set by hand** (Leadership and Finance). For metrics that add up, Pulse flags it when the four quarters don't add up to the year.
- **Actuals:** Finance enters month-end figures until Xero and Autotask fill them in automatically (0.6.0). Changing a figure that's already there needs a reason; every change is audited.
- Seen by Leadership, Finance & Accounts and Finance detail.

## Release plan
**Release 1: Leadership and EOS core**
- Entra SSO with Conditional Access (MFA + compliant device); People directory and identity matching (D10); Autotask departments view and two-way default-department changes (D16).
- Company Scorecard (D4) with automatic filling, overrides with reasons, weekly lock after the Tuesday L10 (D1, D5).
- Rocks, Issues, To-dos, L10 meeting, V/TO, Accountability Chart.
- Planner To-do sync; Issue → Autotask ticket or task; Scorecard → suggested Issues (D11).
- Teams app, tab and bot notifications (D12).
- Pipeline, Marketing ROI and Whitespace inside Pulse with the Brand V5 look and feeding the Scorecard (D9).
- Central credential vault and Connections page (D7). Audit log and security baseline (D8).
- Help centre, metric explanations, FAQ, what's new (D13).
- Test and production environments, pulse.hdit.com.au, Defender for Cloud (D14).

**Release 2:** AI features (D15); Managed Services division dashboards (service desk, NOC, projects, client success); people tools (People Analyzer, Quarterly Conversations, 1:1s).

**Later releases, one division at a time:** Finance (monthly SLI ratios from Xero), Sales & Marketing, Innovation & Compliance, People (HR).

## Reuse from earlier work
- Entra app registration "HD IT Pulse (Test)", roles, groups and setup script (`hdit-pulse/setup/pulse-setup.sh`, `docs/IDENTITY-AND-ACCESS.md`).
- Shared token checks (`pulse-auth.js`) and the Pulse-to-app sign-in bridge already in Pipeline (v1.13.0), Marketing ROI (v0.6.0) and Whitespace Matrix (v0.8.0).
- Pulse v0.3.0 shell is superseded by this plan (start fresh, keep the identity work).
- Release 1 architecture and build plan: `docs/ARCHITECTURE.md` (approved 31 Oct 2026).

## Confirmed before build (30 Oct 2026)
1. **L10 tab:** the General channel of the leadership team in the main HD IT tenant (tenant `d89fb131-4d46-43cf-be60-075d35d8b815`, team group `7085832f-75a0-4d4b-af52-faaf8ef086e1`, channel `19:7246f99d73eb4d779c7d9c090ea0abab@thread.skype`).
2. **Week lock:** 5pm Tuesday (Sydney), at a fixed time. Concluding the L10 doesn't lock early.
3. **Overrides:** for that week only, with a mandatory reason; every override is audited and can be reverted. **Leadership can override any measurable; staff can override only their own division's measurables** (a measurable's division follows its owner's seat). Enforced by the backend. (Decided 30 Oct 2026.)
4. **To-dos:** Planner is the home (two-way sync, D11).
5. **Devices:** all staff, including offshore NOC, are on Intune-managed compliant devices (D8 confirmed).
6. **Platform Admins:** George Hanna and Bernadette Hanna.
7. **Test tenancy licences:** Microsoft 365 Business Premium, so Teams, Planner and the bot are tested there with a test leadership team (31 Oct 2026).
