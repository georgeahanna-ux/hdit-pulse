# Changelog

## 0.8.0 — 11 November 2026
Two-way links (M4, D11).
- **To-dos <-> Microsoft Planner:** company To-dos and the "Pulse – L10" plan sync both ways every 5 minutes (sync service, managed identity, Graph `Tasks.ReadWrite.All`, no secret). Three-way merge per field (title, due date, done, owner) against the values both sides last agreed on: a change on one side goes to the other; changed on both, Pulse wins. New To-dos become tasks (assigned through the People directory's Entra ids; unassigned if Planner won't take the person), tasks added in Planner become To-dos, deletions mirror, ETags on every write. Sync state in `todo_planner`, so To-do history only changes with content. Every change the sync makes is audited as "Planner sync". The plan is chosen on Connections → Microsoft Planner (Platform Admins, audited); Pulse lists the other plans in the same group for Rocks.
- **Issue -> Autotask:** Create in Autotask on an Issue (Issues List, division lists, IDS) makes an internal ticket (HD IT's own company, chosen queue and priority, status New, due 5pm Sydney) or a project task (open project, optional phase and hours), with a note saying which Issue it came from. Required picklists Pulse isn't given take Autotask's default. New `issues` module in the Autotask allow-list: create Tickets and Tasks only; read Tickets, Tasks, Projects, Phases, Resources. Number and status read back every 5 minutes (`issue_link`); a completed ticket marks the Issue "ready to mark solved". Audited.
- **Rock progress:** Link progress to an Autotask project (hours worked ÷ worked + remaining, as on the Gantt) or a Planner plan (tasks complete; in progress counts half), refreshed every 5 minutes (`rock_link`). Audited.
- New "links" job every 5 minutes (also on request and from Diagnose); Diagnose shows link counts and errors.
- Migration `0015_links`. 11 new tests (140 in total).

## 0.7.1 — 11 November 2026
After the first L10 run (George, 11 Nov 2026).
- **Top three numbering:** each of 1, 2 and 3 goes to one open Issue on a list at a time. The number is greyed out on the other Issues until it's cleared (IDS in the L10 and the Issues page), and the server refuses a second Issue with the same number (409), so two people numbering at once can't clash. An Issue's own number always stays clickable, so any clash from before can be cleared. 1 new test (129 in total).

## 0.7.0 — 10 November 2026
The L10 meeting, run in Pulse (M3; D1, D5, D11).
- **L10 page** (Leadership): next meeting (Tuesday 9:30am Sydney) and the week it reviews, headlines for the next meeting, the agenda, and past meetings with rating, length, To-do completion and Issues solved.
- **Live meeting:** one live meeting per team (unique index). Whoever starts it facilitates; anyone in the team can take over (audited). Everyone with it open follows the facilitator: the page reads the meeting's state every 4 seconds and can look at another section without moving the meeting. Clocks for the section and the meeting (server time), red when over. Attendees: the leadership team from the Accountability Chart (Visionary, Integrator and the seats reporting to the Integrator), plus anyone who opens it; online dots; the facilitator marks people here or away and adds guests.
- **Sections:** segue; Scorecard (the company grid, plus the review week's off-target numbers with Drop to Issues, flagging those off target two weeks running: D11's suggested Issues); Rock review (company Rocks, off-track ones to Issues); headlines (add, drop to Issues); To-do list (the team's To-dos open at the last meeting's end or done since, completion rate of those due); IDS (top three numbering, Add a To-do linked to the Issue, Solved with the decision, Drop); conclude (new To-dos, Issues solved, cascading messages, ratings 1–10 with a comment under 8, average).
- **Drop to Issues** records where an Issue came from (`issue.source_kind`, `source_id`: measurable, rock, headline, todo) and won't add a second open Issue for the same thing.
- **End the meeting** stores a summary (attendance, ratings, average of those present, minutes per section, To-do completion, new To-dos, solved and new Issues, headlines, Rocks off track, cascading messages, notes) and marks the headlines as shared. Ratings can still be given for 12 hours afterwards. Summary page with print or save as PDF. Start and end are audited.
- Scribe's notes save as you type and don't count as a meeting change, so they don't make everyone's screen redraw.
- Migration `0014_l10` (meeting, meeting_attendee, headline). 10 new tests (128 in total).

## 0.6.5 — 10 November 2026
Sales and customer feedback measurables, on trial (D4 items 1–3, 10–11), and one Autotask user for the apps.
- **MQLs** from Marketing ROI (D9): the sync service calls Marketing ROI's `GET /api/pulse/measures` every hour with an app-only token for the HD IT Pulse app registration (its managed identity, role `Pulse.Collector`; no secret). Marketing ROI 0.7.0 records when each opportunity with a marketing event first reaches MQL or beyond; Pulse counts them by Sydney week. Leads already at MQL when Marketing ROI first saw them are dated by creation date and counted as estimated. Only ids and dates cross over. New app setting `APP_MROI_API`.
- **New MRR signed**: monthly revenue on opportunities at "Stage 9: Closed Won" by close date. **Weighted pipeline**: active opportunities at stages 6 and 7, one-off revenue × probability (Pipeline's total, without board filters). Both from Autotask with the single API user (scorecard module, read-only), so Pipeline isn't needed for them. Autotask keeps no stage history, so weighted pipeline is a reading of the current week only; such "snapshot" collectors don't hold up the 12-week fill.
- **CSAT and NPS** from SimpleSAT (API key from Connections, read-only, sent only in the `X-Simplesat-Token` header): `POST /api/v1/answers/search`, every page, once per run. CSAT = positive ÷ all primary CSAT ratings in the week (SimpleSAT's sentiment, so it matches its reports); NPS = % promoters less % detractors over the 90 days to the week's end. No customer names, emails or comments are kept. Diagnose can request `inspect:simplesat` (field names and ratings only) to confirm the answer format.
- **One Autotask user for the apps:** Pipeline 1.14.0, Marketing ROI 0.7.0 and Whitespace Matrix 0.9.0 read Pulse's `autotask-service` secret (setting `AUTOTASK_SHARED_SECRET_URI`); `pulse-setup.sh release1` gives each app identity read access to that one secret. Their own Autotask secrets are a fallback. This also gets Pipeline working in test, which had no Autotask credentials.
- Migration `0013_sales_and_feedback`. 9 new tests (118 in total).

## 0.6.4 — 9 November 2026
Xero (D17): Connect to Xero and the finance measurables, on trial.
- **Connect to Xero** on the Connections page (Platform Admins): Pulse's API issues a one-time state (10 minutes, single use), the browser goes via the sync service to Xero's sign-in, and Xero's reply comes back to the sync service, which saves the refresh token and organisation to Key Vault (`xero-token`) and returns to Connections. Read-only granular scopes only: profit and loss, balance sheet, bank summary, settings, plus offline_access. Audited (start and connect).
- Each hourly run renews the token once and saves Xero's new refresh token before using it. If the connection lapses, the Connections card says to reconnect.
- **On trial:** cash on hand (Bank Summary closing balances), debtor days (receivables ÷ last 91 days' revenue plus GST × 91), services gross margin (by SLI reporting codes once Finance sets them; the whole business's gross margin until then, labelled as such), EBITDA % (net profit plus depreciation, amortisation, interest and tax, less interest income, ÷ revenue). Monthly ones show month-to-date and provisional. FY plan **Revenue** fills in monthly from trading income.
- A failing source no longer stops the others in the hourly run (the run is still marked failed so it shows).
- **SGM by Finance's account list** (10 Nov 2026): revenue 41113, 41114, 41115, 45131 (I22); costs 51114, 51119, 57100, 57110, 57120, 57130, 57140, 57150, 57170, 57190, 51115, 52222, 51103 (C11–C13), matched by Xero account code (migration `0011_sgm_accounts`).
- After the first real Xero run (10 Nov): debtor days find receivables by Xero's system account (DEBTORS); SGM and EBITDA % show the latest whole month, provisional for 20 days after it ends, because a part month leaves out wages and depreciation posted later (migration `0012_xero_recount`).
- Home progress cards show the automatic figure while a plan metric is on trial ("Autotask says…", "Xero says…") with a link to switch it on; before, the cards said "No figures yet".
- Division and seat pages ("This division's numbers", owned measurables) do the same: while a measurable is on trial and nobody has typed a value, the tile shows the automatic figure marked **On trial**, linking to the Scorecard; before, it showed a dash.
- Migration `0010_xero`. 6 new tests (109 in total).

## 0.6.3 — 9 November 2026
Projects: set up dependencies by ticking tasks, saved to Autotask (requested 9 Nov 2026).
- **Link tasks** (Project Managers and Leadership) on the project Gantt: tick tasks in the order they should happen, then choose one after another, all after the first ticked, or the last ticked after all the others, with an optional gap in working days. Pulse previews the new dependencies and, if ticked, moves tasks that would start before what they wait for (their own successors keep their gaps). Saved to Autotask as task predecessors (`/Tasks/{id}/Predecessors`), dates first; audited.
- Loops are refused before anything is saved; links that already exist are skipped.
- **Remove a dependency** from a task's panel (the only delete Pulse can make in Autotask: a link, never a record of work; audited).
- Fixes from the first real run against Autotask: the next page of a query is POSTed again (Autotask answers 405 to GET); time-off fields are found by name; the people sync only asks for fields this Autotask has (Departments has no isActive); Key Vault refusals are reported as such.
- New seats: quotes record seats as product lines named after the seat services (checked on opportunity 29725715), so those lines now count; migration `0009_new_seats_recount` clears the earlier zeros so they are worked out again. New seats count opportunities at the stage "Stage 9: Closed Won" (confirmed 9 Nov 2026), falling back to Closed/Implemented status only where no such stage exists. Diagnose can ask for a read-only look at one opportunity and its quotes.
- 3 new tests (102 in total).

## 0.6.2 — 9 November 2026
Projects module, part 3 (D21): resource planner, lead time and what-if.
- **Resource planner** (Projects → Resource planner): each person's project hours allocated against available, week by week for 8, 12 or 26 weeks, like MS Project's Resource Usage. Colour bands: under 60%, 60–85%, 85–100%, over-allocated; leave and overdue work marked. Expand a person to see the tasks behind each week. A whole-team row and an Unassigned row (open tasks with nobody on them). Tiles: next four weeks' utilisation, who's over-allocated, who's under 60%, unassigned hours.
- **Allocation:** each open task's remaining hours (or estimate less time worked) spread evenly over its remaining working days; overdue work lands this week.
- **Capacity:** 7.6 hours a working day, less public holidays and approved leave from Autotask, less a share kept for service desk and other work (20% to start). Project Managers set the share and which departments always appear (Capacity settings).
- **Project lead time** (for Sales too, under Sales & Marketing): work in the queue in hours, person-days and person-weeks; the team's weekly project capacity; weeks to clear the queue; the week a new project could start; when the Autotask schedule's last task ends. Size a new project (hours, engineers) for an estimated start and finish. **What if:** add people (how many, project hours a week, from when) to see the new lead time and a burn-down chart against today's team. Counts open projects only (decided 9 Nov 2026). Nothing in the what-if is saved.
- New endpoints `/projects/resources`, `/projects/lead-time`, `/projects/settings`. 2 new tests (99 in total).
- Follow-up (9 Nov): sync jobs report a Key Vault refusal as an error ("run pulse-setup.sh release1 again") instead of "not entered yet"; new read-only **Diagnose test** workflow (recent sync runs, credentials entered, Autotask data held, Key Vault role assignments).

## 0.6.1 — 9 November 2026
Projects module, part 2 (D21): time entries, completing tasks and rescheduling.
- **Log time** on a task from the project Gantt: day, hours, what you did, internal notes, and optionally mark the task complete. Saved to Autotask as a time entry as the person's own linked resource (People directory) and the task's role. Engineers on their own tasks (primary or secondary); Project Managers and Leadership on any. Last 30 days, 0.1–16 hours.
- **Mark complete** sets the task's Complete status in Autotask.
- **Drag to reschedule** (Project Managers and Leadership): drag a bar to move it, or its ends to change its dates; dates snap to working days. Pulse previews every task that moves: when an end date changes, successors move by the same number of working days; when a start date changes, predecessors do (complete tasks stay put). Nothing reaches Autotask until the Project Manager selects Save; the server re-checks the plan and refuses if the project changed since the preview. Each task's time of day is kept. **Undo** puts them back (for 15 minutes, if nobody has changed them since).
- **Save baseline** keeps today's task dates to measure slippage against.
- Every time entry, completion, reschedule, undo and baseline is in the audit log with old and new dates. 5 new tests (97 in total).

## 0.6.0 — 9 November 2026
Projects module, part 1 (D21): programme and project Gantt charts.
- **Projects** (under Managed Services in the menu) for Leadership, Project Managers and Managed Services: every active Autotask project (not templates or baselines), grouped by client, on one Gantt chart. Tiles for open, late and at-risk projects and work remaining in days, hours and person-weeks. Search, filter by health, zoom by weeks, months or quarters, collapse clients, open a project's phases inline.
- **Project Gantt:** phases with summary brackets, tasks with progress, milestones, dependency arrows, critical path, baseline bars, today line, weekends and public holidays shaded; who's assigned and hours worked against estimate; "My tasks only". Select a task for its dates, hours, float and what it waits for.
- **Health:** done, late (past its end), at risk (an overdue task, or progress more than 15 points behind time elapsed), on track, not started.
- Sync service copies projects, phases, tasks, predecessors, secondary resources, task hours, leave and holidays from Autotask every 15 minutes (projects module of the Autotask connection); "Refresh from Autotask" re-reads one project at once.
- New role **Pulse.ProjectManager** (group *Pulse - Project Managers*); rescheduling arrives in 0.6.1.
- Migration `0008_projects`. 6 new tests (92 in total).

## 0.5.4 — 9 November 2026
One Autotask connection; apps under their division; seats, new seats and MRR on trial.
- **One Autotask API user for all of Pulse** (decided 9 Nov 2026, replacing D7's per-area users). Stored in the existing Key Vault secret `autotask-service`, so no Key Vault change is needed. Least privilege now lives in Pulse: each module (people, scorecard, projects) may only read and write the Autotask entities listed in `lib/autotask.js` `POLICY`; anything else is refused before a request leaves Pulse. No module can delete. The Connections page shows a single **Autotask** card listing every permission the API user needs.
- **Apps sit under their division** in the menu: Pipeline, Marketing ROI and Whitespace Matrix under Sales & Marketing. Anyone who can open an app without seeing its division finds it under "Your apps".
- **Seats serviced** and **New seats signed** fill in on trial (seat = units of the three seat services named by George on recurring-service contracts; new seats = seat quantity on won opportunities' primary quotes, by close date).
- **FY plan:** MRR (recurring contract services converted to a monthly amount), Seats and New seats month-end figures fill in on trial from Autotask; Leadership or Finance switch each to automatic with a reason. Entered figures always take priority.
- Migration `0007_seats_mrr`. 3 new tests (86 in total).

## 0.5.3 — 3 November 2026
Milestone M2, part 2: Autotask collectors in trial ("shadow") mode.
- Sync service works out four Managed Services measurables every hour from Autotask with the **Autotask: Service** credential (read-only use): SLA first response met, tickets closed per tech per day, first-contact resolution (proposed: one time entry), billable utilisation. Techs are resources whose default department was Service Desk at the end of the week (department history from 0.5.2). Working days come off Autotask's holiday set; standard day 7.6 hours.
- Each run covers the current week, the week under review until it locks, and a one-off fill of up to 12 earlier weeks. A locked week's automatic value never changes once set.
- Trial mode: the automatic value is stored and shown under the typed-in one but never counted until Leadership switches the measurable to automatic (`POST /measurables/:id/automatic`, with a reason, audited). Cell panels show how each value was worked out; the definition panel compares typed-in and automatic values week by week.
- Leadership can ask for a run now (`POST /scorecard/refresh`, picked up within two minutes).
- Migration `0006_collectors`: `measurable.collector`, who last switched automatic on or off, `scorecard_value.auto_detail`, settings for hours a day, tech department and holiday set; definitions of the four measurables rewritten with their calculation and a worked example.
- 10 new tests (82 in total).

## 0.5.2 — 3 November 2026
Milestone M2, part 1: People directory (D10) and Autotask departments (D16).
- **People and departments** page (Platform → People and departments) for Leadership and Platform Admins, with three tabs:
  - **Directory:** everyone in Pulse with their linked Autotask resource, default department, and when they last used Pulse. Platform Admins can change a link, mark that someone has no Autotask account, or go back to automatic matching (each needs a reason and is audited).
  - **Autotask departments:** who has each default department, with Service Desk marked as "Techs for the Scorecard". Leadership and Platform Admins tick one or more people and change their default department; Pulse writes it to Autotask straight away (`ResourceRoleDepartments`), adding the person to the department with their current role (or a chosen role) if needed, then re-reads them to confirm.
  - **Needs review:** people with no Autotask match, more than one match or a conflicting link, plus Autotask accounts not linked to anyone.
- Sync service: Autotask departments, roles, resources and department pairings every 15 minutes; Entra users (licensed, enabled, members only) daily; on-demand refresh from the page. Matching by any Autotask email (primary, second or third) against any Entra address; links set by an admin always win.
- Migration `0005_people_directory`: Entra fields on `person`, Autotask departments, roles, resources and pairings (temporal), `person_link` (temporal) and `person_link_none`, `directory_review`, `sync_request`.
- Needs the **Autotask: People administration** credential on the Connections page; Entra uses the sync service's managed identity.
- 13 new tests (72 in total).

## 0.5.1 — 3 November 2026
Connections page: credential entry moved forward from 1.0 (decided 3 Nov 2026).
- Platform Admins enter, replace and remove each integration credential in Pulse. Values go straight to Key Vault through the API's write-only role ("Pulse Secret Writer"); they are never stored in SQL, logged, or returned to the browser, and can't be shown again.
- Autotask credentials are tested before saving (zone lookup, then a signed-in call); the REST address found is saved with them.
- Replacing or removing a credential needs a reason. Owner and rotation-due date per connection; "Rotation overdue" flag. Every change audited with field names only.
- Migration `0004_connection_details` (who last changed each credential).
- `backend/src/lib/credentials.js` defines every connection, its fields and the permissions its API user needs. 5 new tests (59 in total), including that no credential value reaches SQL or the audit log.

## 0.5.0 — 3 November 2026
Milestone M1: EOS core, navigation by division and role (D18), FY progress bars (D19).
- Migration `0003_accountability_chart`: 23 seats with roles, key results, reporting lines and holders (job title and team) from the Accountability Chart (19 Aug 2026) and Org Chart (21 Aug 2026); functions reworked to match; division key results; each seat's apps; company measurables linked to their division's head seat.
- Front end: Home (My Pulse) with your seat, To-dos, Rocks and measurables, plus FY27 progress bars for Leadership and Finance; Company section (Scorecard grid with enter / override / revert dialogs and definitions, Rocks with milestones, Issues with top-three priorities, To-dos, V/TO, Accountability Chart editor, FY plan with quarter targets and month-end entry); division pages with tabs; seat (role) pages with holders by team, owned measurables, Rocks, apps and a proposed role scorecard.
- API: seat holders carry job title and team; seats carry apps; seat holders and measurable owners match the signed-in person by email, or by name while emails are unknown (display only; permissions come from Entra groups).
- Preview mode has a simulated API for every page.
- 54 backend tests.

## 0.4.3 — 3 November 2026
Milestone M1, part 1: database and API (pages follow in 0.5.0).
- Migration `0002_eos_core`: divisions and functions (D3), seats and seat holders (Accountability Chart), measurables (the 15 from D4, manual until M2), weekly Scorecard values with entered / automatic / override values, Rocks and milestones, Issues, To-dos, V/TO sections, annual plan (FY27 targets from the V/TO; quarter targets by hand; month-end actuals). All edited tables temporal.
- API: `/structure`, `/seats`, `/me/summary`, `/scorecard` (enter, override, revert), `/measurables`, `/rocks`, `/issues`, `/todos`, `/vto`, `/plan`. Every change audited; overrides and changes to existing month-end figures need a reason.
- Financial-year helpers (FY27 = Jul 2026–Jun 2027) and annual plan progress maths (cumulative and level metrics, quarter sub-bars, time elapsed).
- 21 new tests (53 in total).

## 0.4.2 — 3 November 2026
- Pulse backend switched on in test: database, API and sync service deployed; migration 0001 applied.
- API `/health` reports the last sync run, so a deploy can confirm the sync service is working.
- Deploy smoke test retries the sync service health check and reports its HTTP status.

## 0.4.1 — 31 October 2026
- Sign-in page: HD IT logo and "Keep IT Moving" tagline aligned left, as designed.

## 0.4.0 — 31 October 2026
Release 1, milestone M0 (foundations). See `docs/ARCHITECTURE.md`.
- **Backend:** one package (`backend/`) deployed as two Function Apps: `func-hdit-pulse-api` (user-facing API) and `func-hdit-pulse-sync` (timers, integrations). Each runs as its own managed identity.
- **Database:** Azure SQL (Basic in test), Entra-only sign-in. Migration `0001_foundations`: people, append-only audit trail, sync runs, connection status, settings; temporal history on edited tables. Migrations run from GitHub Actions (`backend/scripts/migrate.js`).
- **Key Vault:** one placeholder per integration credential, readable only by the component that needs it (secret-level RBAC). API identity is write-only via the custom "Pulse Secret Writer" role.
- **API:** `/health`, `/me` (records the sign-in), `/calendar/week`, `/audit`, `/audit/view`, `/connections`. Entra tokens checked on every request; access from app roles (`backend/src/lib/access.js`), including the override rule (leadership any measurable, staff own division).
- **Sync:** hourly check of which credentials have been entered (never stores values).
- **Scorecard calendar:** Monday–Sunday Sydney weeks, lock 5pm Tuesday after, daylight saving handled (`backend/src/lib/time.js`, tests).
- **Front end:** rebuilt in Brand V5 as ES modules (no inline scripts; CSP `script-src 'self'`). Audit log and Connections pages. Help pages rebranded.
- **Setup:** `pulse-setup.sh release1` (identities, Key Vault, secret access) and `release1-entra` (new roles and groups, SQL admin group, Pulse.Collector, Graph permissions for the sync identity).
- **Infra:** `infra/main.bicep` adds SQL, Key Vault, storage, monitoring and both Function Apps; deployed only once `sqlAdminGroupId` is set.

## 0.3.0 — 23 October 2026
- Pulse becomes the front door for HD IT apps: Microsoft 365 (Entra ID) sign-in with MSAL, no third-party cookies.
- Pipeline, Marketing ROI and Whitespace Matrix open inside Pulse and are signed in by it; each person sees only the apps their Entra groups allow.
- Access model: app roles on the HD IT Pulse app registration, assigned to "Pulse - …" security groups. "Your access" page.
- Division dashboards from the prototype shown as Coming soon.
- Setup script for the HD IT Testing Tenancy; GitHub Actions deploy to `rg-hdit-pulse-test-aue`.

## 0.2.0 — September 2026
- Clickable prototype on sample data with persona-based access.
