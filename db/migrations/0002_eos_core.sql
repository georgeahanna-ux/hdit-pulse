-- =============================================================================
-- 0002 EOS core (Pulse 0.5.0, milestone M1)
-- Divisions, functions and seats (Accountability Chart); measurables and weekly Scorecard
-- values with overrides; Rocks and milestones; Issues; To-dos; V/TO; the annual plan
-- (FY targets, quarter targets, month-end actuals).
-- Edited tables are system-versioned, so every change keeps its history (D6).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Divisions and their functions (D3). Seeded here; seats come from the Accountability Chart.
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.division (
  code         NVARCHAR(40)  NOT NULL CONSTRAINT pk_division PRIMARY KEY,
  name         NVARCHAR(100) NOT NULL,
  summary      NVARCHAR(500) NULL,
  sort         INT NOT NULL CONSTRAINT df_division_sort DEFAULT (0)
);
GO

CREATE TABLE pulse.division_function (
  id             INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_division_function PRIMARY KEY,
  division_code  NVARCHAR(40)  NOT NULL CONSTRAINT fk_function_division REFERENCES pulse.division (code),
  name           NVARCHAR(100) NOT NULL,
  sort           INT NOT NULL CONSTRAINT df_function_sort DEFAULT (0),
  CONSTRAINT uq_function UNIQUE (division_code, name)
);
GO

INSERT INTO pulse.division (code, name, sort) VALUES
  (N'Leadership', N'Leadership', 0),
  (N'Finance', N'Finance & Accounts', 1),
  (N'People', N'People (HR)', 2),
  (N'SalesMarketing', N'Sales & Marketing', 3),
  (N'InnovationCompliance', N'Innovation & Compliance', 4),
  (N'ManagedServices', N'Managed Services', 5);

INSERT INTO pulse.division_function (division_code, name, sort) VALUES
  (N'Leadership', N'Visionary', 1), (N'Leadership', N'Integrator', 2),
  (N'SalesMarketing', N'Marketing', 1), (N'SalesMarketing', N'Business Development', 2),
  (N'SalesMarketing', N'Sales Admin', 3), (N'SalesMarketing', N'Account Management', 4),
  (N'InnovationCompliance', N'DevOps', 1), (N'InnovationCompliance', N'Compliance', 2),
  (N'ManagedServices', N'Service Team', 1), (N'ManagedServices', N'Projects', 2),
  (N'ManagedServices', N'Client Success', 3), (N'ManagedServices', N'Service Admin', 4),
  (N'ManagedServices', N'NOC', 5);
GO

-- ---------------------------------------------------------------------------
-- Seats (Accountability Chart). A seat has up to about five roles (accountabilities)
-- and one key result; one or more people sit in it.
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.seat (
  id              INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_seat PRIMARY KEY,
  division_code   NVARCHAR(40)  NOT NULL CONSTRAINT fk_seat_division REFERENCES pulse.division (code),
  function_id     INT NULL CONSTRAINT fk_seat_function REFERENCES pulse.division_function (id),
  parent_seat_id  INT NULL CONSTRAINT fk_seat_parent REFERENCES pulse.seat (id),
  title           NVARCHAR(150) NOT NULL,
  roles_json      NVARCHAR(4000) NULL,     -- ["Lead, manage and hold accountable", ...]
  key_result      NVARCHAR(500) NULL,
  sort            INT NOT NULL CONSTRAINT df_seat_sort DEFAULT (0),
  is_active       BIT NOT NULL CONSTRAINT df_seat_active DEFAULT (1),
  valid_from      DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to        DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.seat_history));
GO

-- Who sits in a seat. Matched to a person by email when they sign in (person_id filled then).
CREATE TABLE pulse.seat_holder (
  id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_seat_holder PRIMARY KEY,
  seat_id       INT NOT NULL CONSTRAINT fk_holder_seat REFERENCES pulse.seat (id),
  holder_name   NVARCHAR(200) NOT NULL,
  holder_email  NVARCHAR(320) NULL,
  person_id     INT NULL CONSTRAINT fk_holder_person REFERENCES pulse.person (id),
  valid_from    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to      DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.seat_holder_history));
CREATE INDEX ix_holder_email ON pulse.seat_holder (holder_email);
GO

-- ---------------------------------------------------------------------------
-- Measurables and the weekly Scorecard (D1, D4, D5)
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.measurable (
  id              INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_measurable PRIMARY KEY,
  code            NVARCHAR(60)  NOT NULL CONSTRAINT uq_measurable_code UNIQUE,
  name            NVARCHAR(150) NOT NULL,
  scope           NVARCHAR(20)  NOT NULL CONSTRAINT ck_measurable_scope CHECK (scope IN (N'company', N'division')),
  division_code   NVARCHAR(40)  NOT NULL CONSTRAINT fk_measurable_division REFERENCES pulse.division (code),
  seat_id         INT NULL CONSTRAINT fk_measurable_seat REFERENCES pulse.seat (id),
  owner_name      NVARCHAR(200) NULL,
  owner_email     NVARCHAR(320) NULL,
  unit            NVARCHAR(20)  NOT NULL CONSTRAINT ck_measurable_unit CHECK (unit IN (N'count', N'currency', N'percent', N'days', N'ratio', N'score')),
  direction       NVARCHAR(10)  NOT NULL CONSTRAINT ck_measurable_dir CHECK (direction IN (N'higher', N'lower')),
  goal_value      DECIMAL(18,4) NULL,
  goal_text       NVARCHAR(200) NULL,
  frequency       NVARCHAR(10)  NOT NULL CONSTRAINT df_measurable_freq DEFAULT (N'weekly') CONSTRAINT ck_measurable_freq CHECK (frequency IN (N'weekly', N'monthly')),
  source          NVARCHAR(20)  NOT NULL CONSTRAINT df_measurable_source DEFAULT (N'manual'),
  auto_enabled    BIT NOT NULL CONSTRAINT df_measurable_auto DEFAULT (0),   -- switched on per measurable in M2
  definition      NVARCHAR(4000) NULL,     -- plain-English: what, why, calculation, example
  definition_version INT NOT NULL CONSTRAINT df_measurable_defver DEFAULT (1),
  restricted      BIT NOT NULL CONSTRAINT df_measurable_restricted DEFAULT (0), -- finance detail only
  sort            INT NOT NULL CONSTRAINT df_measurable_sort DEFAULT (0),
  is_active       BIT NOT NULL CONSTRAINT df_measurable_active DEFAULT (1),
  valid_from      DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to        DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.measurable_history));
GO

-- One row per measurable per week (week = its Monday, Sydney).
-- shown value = override_value if overridden, else entered_value (manual), else auto_value.
CREATE TABLE pulse.scorecard_value (
  measurable_id    INT  NOT NULL CONSTRAINT fk_value_measurable REFERENCES pulse.measurable (id),
  week             DATE NOT NULL,
  auto_value       DECIMAL(18,4) NULL,
  auto_at          DATETIME2(3)  NULL,
  provisional      BIT NOT NULL CONSTRAINT df_value_provisional DEFAULT (0),
  entered_value    DECIMAL(18,4) NULL,
  entered_by_oid   NVARCHAR(64)  NULL,
  entered_by_name  NVARCHAR(200) NULL,
  entered_at       DATETIME2(3)  NULL,
  override_value   DECIMAL(18,4) NULL,
  is_overridden    BIT NOT NULL CONSTRAINT df_value_overridden DEFAULT (0),
  override_reason  NVARCHAR(1000) NULL,
  override_by_oid  NVARCHAR(64)  NULL,
  override_by_name NVARCHAR(200) NULL,
  override_at      DATETIME2(3)  NULL,
  note             NVARCHAR(500) NULL,
  valid_from       DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to         DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to),
  CONSTRAINT pk_scorecard_value PRIMARY KEY (measurable_id, week)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.scorecard_value_history));
GO

-- ---------------------------------------------------------------------------
-- Rocks (90-day priorities) and milestones
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.rock (
  id             INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_rock PRIMARY KEY,
  fy             SMALLINT NOT NULL,
  quarter        TINYINT  NOT NULL CONSTRAINT ck_rock_quarter CHECK (quarter BETWEEN 1 AND 4),
  level          NVARCHAR(20) NOT NULL CONSTRAINT ck_rock_level CHECK (level IN (N'company', N'division', N'individual')),
  division_code  NVARCHAR(40) NULL CONSTRAINT fk_rock_division REFERENCES pulse.division (code),
  title          NVARCHAR(300) NOT NULL,
  description    NVARCHAR(2000) NULL,
  owner_name     NVARCHAR(200) NOT NULL,
  owner_email    NVARCHAR(320) NULL,
  status         NVARCHAR(20) NOT NULL CONSTRAINT df_rock_status DEFAULT (N'on_track')
                 CONSTRAINT ck_rock_status CHECK (status IN (N'on_track', N'off_track', N'done', N'not_done')),
  due_date       DATE NULL,
  created_by     NVARCHAR(200) NULL,
  sort           INT NOT NULL CONSTRAINT df_rock_sort DEFAULT (0),
  is_archived    BIT NOT NULL CONSTRAINT df_rock_archived DEFAULT (0),
  valid_from     DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to       DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.rock_history));
CREATE INDEX ix_rock_quarter ON pulse.rock (fy, quarter, level);
GO

CREATE TABLE pulse.rock_milestone (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_rock_milestone PRIMARY KEY,
  rock_id     INT NOT NULL CONSTRAINT fk_milestone_rock REFERENCES pulse.rock (id),
  title       NVARCHAR(300) NOT NULL,
  due_date    DATE NULL,
  is_done     BIT NOT NULL CONSTRAINT df_milestone_done DEFAULT (0),
  sort        INT NOT NULL CONSTRAINT df_milestone_sort DEFAULT (0),
  is_deleted  BIT NOT NULL CONSTRAINT df_milestone_deleted DEFAULT (0),
  valid_from  DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to    DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.rock_milestone_history));
GO

-- ---------------------------------------------------------------------------
-- Issues (IDS)
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.issue (
  id              INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_issue PRIMARY KEY,
  level           NVARCHAR(20) NOT NULL CONSTRAINT ck_issue_level CHECK (level IN (N'company', N'division')),
  division_code   NVARCHAR(40) NULL CONSTRAINT fk_issue_division REFERENCES pulse.division (code),
  title           NVARCHAR(300) NOT NULL,
  description     NVARCHAR(4000) NULL,
  owner_name      NVARCHAR(200) NULL,
  owner_email     NVARCHAR(320) NULL,
  raised_by_name  NVARCHAR(200) NOT NULL,
  raised_by_oid   NVARCHAR(64)  NOT NULL,
  priority        TINYINT NULL CONSTRAINT ck_issue_priority CHECK (priority IS NULL OR priority BETWEEN 1 AND 3),
  status          NVARCHAR(20) NOT NULL CONSTRAINT df_issue_status DEFAULT (N'open')
                  CONSTRAINT ck_issue_status CHECK (status IN (N'open', N'solved', N'dropped')),
  solution        NVARCHAR(4000) NULL,
  closed_at       DATETIME2(3) NULL,
  measurable_id   INT NULL CONSTRAINT fk_issue_measurable REFERENCES pulse.measurable (id),
  created_at      DATETIME2(3) NOT NULL CONSTRAINT df_issue_created DEFAULT (SYSUTCDATETIME()),
  valid_from      DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to        DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.issue_history));
CREATE INDEX ix_issue_status ON pulse.issue (level, division_code, status);
GO

-- ---------------------------------------------------------------------------
-- To-dos (seven-day commitments). Planner sync arrives in M4 (planner_task_id).
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.todo (
  id               INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_todo PRIMARY KEY,
  level            NVARCHAR(20) NOT NULL CONSTRAINT ck_todo_level CHECK (level IN (N'company', N'division', N'individual')),
  division_code    NVARCHAR(40) NULL CONSTRAINT fk_todo_division REFERENCES pulse.division (code),
  title            NVARCHAR(300) NOT NULL,
  owner_name       NVARCHAR(200) NOT NULL,
  owner_email      NVARCHAR(320) NULL,
  due_date         DATE NOT NULL,
  is_done          BIT NOT NULL CONSTRAINT df_todo_done DEFAULT (0),
  done_at          DATETIME2(3) NULL,
  issue_id         INT NULL CONSTRAINT fk_todo_issue REFERENCES pulse.issue (id),
  planner_task_id  NVARCHAR(100) NULL,
  created_by_name  NVARCHAR(200) NOT NULL,
  created_at       DATETIME2(3) NOT NULL CONSTRAINT df_todo_created DEFAULT (SYSUTCDATETIME()),
  is_deleted       BIT NOT NULL CONSTRAINT df_todo_deleted DEFAULT (0),
  valid_from       DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to         DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.todo_history));
CREATE INDEX ix_todo_owner ON pulse.todo (owner_email, is_done);
GO

-- ---------------------------------------------------------------------------
-- V/TO: one row per section; history keeps every version.
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.vto_section (
  [key]        NVARCHAR(40) NOT NULL CONSTRAINT pk_vto_section PRIMARY KEY,
  title        NVARCHAR(100) NOT NULL,
  content      NVARCHAR(MAX) NULL,      -- plain text, one item per line
  sort         INT NOT NULL,
  updated_by   NVARCHAR(200) NULL,
  updated_at   DATETIME2(3) NULL,
  valid_from   DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to     DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.vto_section_history));
GO

INSERT INTO pulse.vto_section ([key], title, sort) VALUES
  (N'core_values', N'Core values', 1),
  (N'core_focus', N'Core focus', 2),
  (N'ten_year_target', N'10-year target', 3),
  (N'marketing_strategy', N'Marketing strategy', 4),
  (N'three_year_picture', N'3-year picture', 5),
  (N'one_year_plan', N'1-year plan', 6),
  (N'quarterly_rocks', N'Quarterly Rocks', 7),
  (N'issues_list', N'Long-term issues', 8);
GO

-- ---------------------------------------------------------------------------
-- Annual plan (D19): FY targets, quarter targets set by hand, month-end actuals.
--   kind 'cumulative': progress = sum of months to date (revenue, new seats)
--   kind 'level':      progress = latest month-end level (MRR, seats)
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.plan_metric (
  id             INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_plan_metric PRIMARY KEY,
  fy             SMALLINT NOT NULL,
  code           NVARCHAR(40) NOT NULL,
  name           NVARCHAR(100) NOT NULL,
  unit           NVARCHAR(20) NOT NULL CONSTRAINT ck_plan_unit CHECK (unit IN (N'currency', N'count')),
  kind           NVARCHAR(20) NOT NULL CONSTRAINT ck_plan_kind CHECK (kind IN (N'cumulative', N'level')),
  annual_target  DECIMAL(18,2) NULL,
  opening_value  DECIMAL(18,2) NULL,     -- level metrics: where the year started (30 June)
  source         NVARCHAR(20) NOT NULL CONSTRAINT df_plan_source DEFAULT (N'manual'),
  restricted     BIT NOT NULL CONSTRAINT df_plan_restricted DEFAULT (0),
  sort           INT NOT NULL CONSTRAINT df_plan_sort DEFAULT (0),
  valid_from     DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to       DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to),
  CONSTRAINT uq_plan_metric UNIQUE (fy, code)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.plan_metric_history));
GO

CREATE TABLE pulse.plan_quarter_target (
  metric_id   INT NOT NULL CONSTRAINT fk_quarter_metric REFERENCES pulse.plan_metric (id),
  quarter     TINYINT NOT NULL CONSTRAINT ck_quarter CHECK (quarter BETWEEN 1 AND 4),
  target      DECIMAL(18,2) NULL,
  updated_by  NVARCHAR(200) NULL,
  valid_from  DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to    DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to),
  CONSTRAINT pk_plan_quarter_target PRIMARY KEY (metric_id, quarter)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.plan_quarter_target_history));
GO

-- month = first day of the month. shown value = entered_value if present, else auto_value (Xero, M2).
CREATE TABLE pulse.plan_month_actual (
  metric_id      INT  NOT NULL CONSTRAINT fk_month_metric REFERENCES pulse.plan_metric (id),
  month          DATE NOT NULL,
  auto_value     DECIMAL(18,2) NULL,
  auto_at        DATETIME2(3) NULL,
  entered_value  DECIMAL(18,2) NULL,
  entered_by     NVARCHAR(200) NULL,
  entered_at     DATETIME2(3) NULL,
  reason         NVARCHAR(1000) NULL,
  valid_from     DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to       DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to),
  CONSTRAINT pk_plan_month_actual PRIMARY KEY (metric_id, month)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.plan_month_actual_history));
GO

-- FY27 1-year plan from the V/TO (August 2026). Quarter targets are set by hand in Pulse.
INSERT INTO pulse.plan_metric (fy, code, name, unit, kind, annual_target, source, restricted, sort) VALUES
  (2027, N'revenue',   N'Revenue',   N'currency', N'cumulative', 9200000, N'xero',     0, 1),
  (2027, N'mrr',       N'MRR',       N'currency', N'level',       560000, N'autotask', 0, 2),
  (2027, N'seats',     N'Seats',     N'count',    N'level',         2350, N'autotask', 0, 3),
  (2027, N'new_seats', N'New seats', N'count',    N'cumulative',     650, N'autotask', 0, 4);
GO

-- ---------------------------------------------------------------------------
-- Company Scorecard, starting list (D4). Manual until each source is switched on in M2.
-- ---------------------------------------------------------------------------
INSERT INTO pulse.measurable (code, name, scope, division_code, owner_name, unit, direction, goal_value, goal_text, frequency, source, sort, definition) VALUES
 (N'mqls', N'MQLs', N'company', N'SalesMarketing', N'Faben Miglani', N'count', N'higher', 7, N'7 or more a week (30 a month)', N'weekly', N'mroi', 1,
  N'Marketing-qualified leads created this week. A lead is an MQL when Marketing ROI moves it to the MQL stage.'),
 (N'new_mrr', N'New MRR signed', N'company', N'SalesMarketing', N'Faben Miglani', N'currency', N'higher', NULL, N'Pace to $560K MRR', N'weekly', N'pipeline', 2,
  N'Monthly recurring revenue on opportunities won this week.'),
 (N'weighted_pipeline', N'Weighted pipeline (Stages 6–7)', N'company', N'SalesMarketing', N'Faben Miglani', N'currency', N'higher', NULL, N'Set with owner', N'weekly', N'pipeline', 3,
  N'Sum of opportunity value × probability for opportunities in stages 6 and 7, at the end of the week.'),
 (N'new_seats', N'New seats signed', N'company', N'SalesMarketing', N'Faben Miglani', N'count', N'higher', 12.5, N'12.5 or more a week (650 a year)', N'weekly', N'autotask', 4,
  N'Seats added on contracts signed this week.'),
 (N'seats_serviced', N'Seats serviced', N'company', N'ManagedServices', N'Tony Parzakonis', N'count', N'higher', 2350, N'2,350 or more', N'weekly', N'autotask', 5,
  N'Seats under active managed-services contracts at the end of the week.'),
 (N'sla_first_response', N'SLA first response met', N'company', N'ManagedServices', N'Tony Parzakonis', N'percent', N'higher', 95, N'95% or more', N'weekly', N'autotask', 6,
  N'Share of tickets created this week whose first response met its SLA.'),
 (N'tickets_per_tech', N'Tickets closed per tech per day', N'company', N'ManagedServices', N'Tony Parzakonis', N'ratio', N'higher', NULL, N'Set with owner (Evergreen benchmark 10)', N'weekly', N'autotask', 7,
  N'Tickets completed this week ÷ (techs × working days). A tech is an active Autotask resource whose default department is Service Desk (D16).'),
 (N'fcr', N'First-contact resolution', N'company', N'ManagedServices', N'Tony Parzakonis', N'percent', N'higher', NULL, N'Set with owner', N'weekly', N'autotask', 8,
  N'Share of tickets completed this week that were resolved on first contact.'),
 (N'utilisation', N'Billable utilisation', N'company', N'ManagedServices', N'Tony Parzakonis', N'percent', N'higher', NULL, N'Set with owner', N'weekly', N'autotask', 9,
  N'Billable hours ÷ available hours for techs this week.'),
 (N'csat', N'CSAT', N'company', N'ManagedServices', N'Tony Parzakonis', N'percent', N'higher', NULL, N'Set with owner', N'weekly', N'simplesat', 10,
  N'Share of survey answers this week that were positive.'),
 (N'nps', N'NPS (last 90 days)', N'company', N'ManagedServices', N'Tony Parzakonis', N'score', N'higher', 65, N'+65 or more', N'weekly', N'simplesat', 11,
  N'Net Promoter Score over the last 90 days: % promoters (9–10) minus % detractors (0–6).'),
 (N'cash', N'Cash on hand', N'company', N'Finance', N'Mandy Moujalli', N'currency', N'higher', NULL, N'Set with owner', N'weekly', N'xero', 12,
  N'Balance of bank accounts at the end of the week.'),
 (N'dso', N'Debtor days (DSO)', N'company', N'Finance', N'Mandy Moujalli', N'days', N'lower', 28, N'28 or fewer', N'weekly', N'xero', 13,
  N'Accounts receivable ÷ revenue over the last 90 days × 90.'),
 (N'sgm', N'Services gross margin (SGM)', N'company', N'Finance', N'Mandy Moujalli', N'percent', N'higher', 45, N'45% or more', N'monthly', N'xero', 14,
  N'SLI F18 Services Gross Margin for the latest month. Provisional until Finance closes the month.'),
 (N'ebitda_pct', N'EBITDA % (Profit)', N'company', N'Finance', N'Mandy Moujalli', N'percent', N'higher', 11, N'11% or more', N'monthly', N'xero', 15,
  N'SLI IS4 EBITDA as a % of revenue for the latest month (not Adjusted EBITDA). Provisional until Finance closes the month.');
GO
