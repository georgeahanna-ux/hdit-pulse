-- 0008 Projects module (D21): a copy of active Autotask projects, refreshed by the sync service
-- every 15 minutes and straight after Pulse changes a project. Autotask stays the system of
-- record; these tables let the Gantt charts and resource planner load instantly.
-- Dates are stored in UTC, as Autotask gives them. Task dates are temporal so slippage can be shown.

CREATE TABLE pulse.at_company (
  id    INT NOT NULL CONSTRAINT pk_at_company PRIMARY KEY,
  name  NVARCHAR(200) NOT NULL
);
GO

CREATE TABLE pulse.at_project (
  id                  INT NOT NULL CONSTRAINT pk_at_project PRIMARY KEY,
  name                NVARCHAR(300) NOT NULL,
  number              NVARCHAR(50)  NULL,
  company_id          INT NULL,
  status              INT NULL,
  status_label        NVARCHAR(100) NULL,
  type_label          NVARCHAR(100) NULL,
  start_at            DATETIME2(0) NULL,
  end_at              DATETIME2(0) NULL,
  estimated_hours     DECIMAL(10,2) NULL,
  lead_resource_id    INT NULL,
  completed_pct       DECIMAL(5,2) NULL,
  is_open             BIT NOT NULL CONSTRAINT df_at_project_open DEFAULT (1),   -- 0 once it's no longer active in Autotask
  synced_at           DATETIME2(3) NOT NULL CONSTRAINT df_at_project_synced DEFAULT (SYSUTCDATETIME())
);
GO

CREATE TABLE pulse.at_phase (
  id               INT NOT NULL CONSTRAINT pk_at_phase PRIMARY KEY,
  project_id       INT NOT NULL,
  parent_phase_id  INT NULL,
  title            NVARCHAR(300) NOT NULL,
  start_at         DATETIME2(0) NULL,
  due_at           DATETIME2(0) NULL,
  estimated_hours  DECIMAL(10,2) NULL,
  sort             INT NULL
);
CREATE INDEX ix_at_phase_project ON pulse.at_phase (project_id);
GO

CREATE TABLE pulse.at_task (
  id                    INT NOT NULL CONSTRAINT pk_at_task PRIMARY KEY,
  project_id            INT NOT NULL,
  phase_id              INT NULL,
  title                 NVARCHAR(300) NOT NULL,
  task_number           NVARCHAR(50) NULL,
  status                INT NULL,
  is_complete           BIT NOT NULL CONSTRAINT df_at_task_complete DEFAULT (0),
  start_at              DATETIME2(0) NULL,
  end_at                DATETIME2(0) NULL,
  estimated_hours       DECIMAL(10,2) NULL,
  remaining_hours       DECIMAL(10,2) NULL,
  worked_hours          DECIMAL(10,2) NULL,          -- sum of its time entries
  assigned_resource_id  INT NULL,
  assigned_role_id      INT NULL,
  completed_at          DATETIME2(0) NULL,
  valid_from  DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to    DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.at_task_history));
CREATE INDEX ix_at_task_project ON pulse.at_task (project_id);
CREATE INDEX ix_at_task_resource ON pulse.at_task (assigned_resource_id);
GO

CREATE TABLE pulse.at_task_predecessor (
  id                   INT NOT NULL CONSTRAINT pk_at_task_predecessor PRIMARY KEY,
  predecessor_task_id  INT NOT NULL,
  successor_task_id    INT NOT NULL,
  lag_days             INT NOT NULL CONSTRAINT df_at_pred_lag DEFAULT (0)
);
CREATE INDEX ix_at_pred_succ ON pulse.at_task_predecessor (successor_task_id);
GO

CREATE TABLE pulse.at_task_secondary (
  id           INT NOT NULL CONSTRAINT pk_at_task_secondary PRIMARY KEY,
  task_id      INT NOT NULL,
  resource_id  INT NOT NULL,
  role_id      INT NULL
);
CREATE INDEX ix_at_task_secondary_task ON pulse.at_task_secondary (task_id);
GO

-- Leave booked in Autotask (approved time off), for resource capacity (D21).
CREATE TABLE pulse.at_time_off (
  id           INT NOT NULL CONSTRAINT pk_at_time_off PRIMARY KEY,
  resource_id  INT NOT NULL,
  day          DATE NOT NULL,
  hours        DECIMAL(6,2) NOT NULL
);
CREATE INDEX ix_at_time_off_resource ON pulse.at_time_off (resource_id, day);
GO

-- A project's baseline: the dates its tasks were planned for when the Project Manager saved it.
CREATE TABLE pulse.project_baseline (
  project_id  INT NOT NULL,
  task_id     INT NOT NULL,
  start_at    DATETIME2(0) NULL,
  end_at      DATETIME2(0) NULL,
  saved_at    DATETIME2(3) NOT NULL,
  saved_by    NVARCHAR(200) NOT NULL,
  CONSTRAINT pk_project_baseline PRIMARY KEY (project_id, task_id)
);
GO

-- Holidays (from Autotask's holiday set), shared by the Scorecard and Projects.
CREATE TABLE pulse.holiday (
  day   DATE NOT NULL CONSTRAINT pk_holiday PRIMARY KEY,
  name  NVARCHAR(200) NULL
);
GO

MERGE pulse.app_setting AS t
USING (VALUES
  (N'projects.non_project_share', N'0.2'),   -- share of each person's day kept for service desk and other work
  (N'projects.people_department', NULL)       -- optional: only these Autotask departments appear in resource planning (JSON list)
) AS s ([key], [value]) ON t.[key] = s.[key]
WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (s.[key], s.[value], N'migration 0008');
GO
