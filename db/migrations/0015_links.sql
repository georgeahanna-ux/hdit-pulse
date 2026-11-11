-- 0015 Two-way links (0.8.0, D11).
--   To-dos  <-> Microsoft Planner: company To-dos and the "Pulse – L10" plan, both ways every 5 minutes.
--   Issues  ->  Autotask: a ticket or project task created from an Issue, its status read back.
--   Rocks   <-  an Autotask project or a Planner plan: progress filled in automatically.
-- Sync state lives in its own tables so the versioned To-do, Issue and Rock rows only change
-- when their content does.

-- One row per To-do linked to a Planner task. snapshot = the values both sides last agreed on
-- (JSON: title, due, done, owner), so a change on either side can be told apart.
CREATE TABLE pulse.todo_planner (
  todo_id      INT NOT NULL CONSTRAINT pk_todo_planner PRIMARY KEY CONSTRAINT fk_todo_planner_todo REFERENCES pulse.todo (id),
  task_id      NVARCHAR(100) NOT NULL CONSTRAINT uq_todo_planner_task UNIQUE,
  etag         NVARCHAR(200) NULL,
  snapshot     NVARCHAR(1000) NOT NULL,
  synced_at    DATETIME2(3) NOT NULL CONSTRAINT df_todo_planner_synced DEFAULT (SYSUTCDATETIME()),
  last_error   NVARCHAR(400) NULL
);
GO

-- Plans Pulse knows about: the L10 plan, and the other plans in the same group (to link Rocks to).
CREATE TABLE pulse.planner_plan (
  id           NVARCHAR(100) NOT NULL CONSTRAINT pk_planner_plan PRIMARY KEY,
  title        NVARCHAR(300) NOT NULL,
  group_id     NVARCHAR(64) NULL,
  group_name   NVARCHAR(300) NULL,
  checked_at   DATETIME2(3) NOT NULL CONSTRAINT df_planner_plan_checked DEFAULT (SYSUTCDATETIME())
);
GO

-- An Issue's Autotask ticket or project task.
CREATE TABLE pulse.issue_link (
  issue_id      INT NOT NULL CONSTRAINT pk_issue_link PRIMARY KEY CONSTRAINT fk_issue_link_issue REFERENCES pulse.issue (id),
  kind          NVARCHAR(10) NOT NULL CONSTRAINT ck_issue_link_kind CHECK (kind IN (N'ticket', N'task')),
  at_id         INT NOT NULL,
  project_id    INT NULL,                        -- for a project task
  number        NVARCHAR(50) NULL,               -- ticket number, e.g. T20261111.0012
  title         NVARCHAR(300) NULL,
  status_label  NVARCHAR(100) NULL,
  is_complete   BIT NOT NULL CONSTRAINT df_issue_link_complete DEFAULT (0),
  created_by    NVARCHAR(200) NOT NULL,
  created_at    DATETIME2(3) NOT NULL CONSTRAINT df_issue_link_created DEFAULT (SYSUTCDATETIME()),
  checked_at    DATETIME2(3) NULL,
  last_error    NVARCHAR(400) NULL
);
GO

-- A Rock's progress source.
CREATE TABLE pulse.rock_link (
  rock_id      INT NOT NULL CONSTRAINT pk_rock_link PRIMARY KEY CONSTRAINT fk_rock_link_rock REFERENCES pulse.rock (id),
  kind         NVARCHAR(20) NOT NULL CONSTRAINT ck_rock_link_kind CHECK (kind IN (N'autotask_project', N'planner_plan')),
  ref          NVARCHAR(100) NOT NULL,          -- Autotask project id, or Planner plan id
  name         NVARCHAR(300) NULL,
  pct          DECIMAL(5,2) NULL,
  detail       NVARCHAR(300) NULL,
  linked_by    NVARCHAR(200) NOT NULL,
  linked_at    DATETIME2(3) NOT NULL CONSTRAINT df_rock_link_linked DEFAULT (SYSUTCDATETIME()),
  checked_at   DATETIME2(3) NULL,
  last_error   NVARCHAR(400) NULL
);
GO

MERGE pulse.app_setting AS t
USING (VALUES
  (N'planner.l10_plan_id', NULL),                          -- set on the Connections page
  (N'autotask.web_url', N'https://ww29.autotask.net'),     -- for links to tickets, tasks and projects
  (N'autotask.internal_company_id', N'0')                  -- HD IT's own company in Autotask, for internal tickets
) AS s ([key], [value]) ON t.[key] = s.[key]
WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (s.[key], s.[value], N'migration 0015');
GO
