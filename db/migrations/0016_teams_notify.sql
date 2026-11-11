-- 0016 Pulse in Teams and its reminders (0.9.0, D12).
-- Reminders go to each person's Teams Activity feed (decided 11 Nov 2026, instead of a bot chat);
-- the weekly one-page summary goes by email from one shared mailbox. Each person can switch either off.

-- One row per reminder sent, so each is sent once. person_key = Entra object id (Teams) or email address (email).
CREATE TABLE pulse.nudge_log (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_nudge_log PRIMARY KEY,
  kind        NVARCHAR(20)  NOT NULL,          -- numbers, l10, l10-todos, overdue, rock, email, test
  ref         NVARCHAR(100) NOT NULL,          -- the week, meeting, To-do or Rock it's about
  person_key  NVARCHAR(320) NOT NULL,
  channel     NVARCHAR(10)  NOT NULL CONSTRAINT ck_nudge_channel CHECK (channel IN (N'teams', N'email')),
  text        NVARCHAR(500) NULL,
  sent_at     DATETIME2(3)  NOT NULL CONSTRAINT df_nudge_sent DEFAULT (SYSUTCDATETIME()),
  error       NVARCHAR(400) NULL,
  CONSTRAINT uq_nudge UNIQUE (kind, ref, person_key, channel)
);
GO

-- Each person's choices (rows only for people who changed something; no row = both on).
CREATE TABLE pulse.person_pref (
  person_oid       NVARCHAR(64) NOT NULL CONSTRAINT pk_person_pref PRIMARY KEY,
  teams_reminders  BIT NOT NULL CONSTRAINT df_pref_teams DEFAULT (1),
  weekly_email     BIT NOT NULL CONSTRAINT df_pref_email DEFAULT (1),
  updated_at       DATETIME2(3) NOT NULL CONSTRAINT df_pref_updated DEFAULT (SYSUTCDATETIME())
);
GO

MERGE pulse.app_setting AS t
USING (VALUES
  (N'teams.app_id', N'd46a6617-9686-4ea3-9801-785e42e3a1db'),   -- the Teams app's manifest id (test)
  (N'mail.sender', NULL),                                       -- the shared mailbox the weekly summary comes from
  (N'notify.enabled', N'1')                                     -- Platform Admins can pause all reminders
) AS s ([key], [value]) ON t.[key] = s.[key]
WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (s.[key], s.[value], N'migration 0016');
GO
