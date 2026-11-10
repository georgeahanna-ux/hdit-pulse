-- 0014 The L10 meeting, run in Pulse (0.7.0, D1, D5, D11).
-- A meeting belongs to a team: the leadership team (level company) now, division teams later.
-- The agenda is EOS's: segue, Scorecard, Rock review, headlines, To-do list, IDS, conclude.
-- Rocks, Issues and To-dos stay in their own tables; the meeting records who came, how it went
-- and a summary taken when it ends.

CREATE TABLE pulse.meeting (
  id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_meeting PRIMARY KEY,
  level              NVARCHAR(20) NOT NULL CONSTRAINT ck_meeting_level CHECK (level IN (N'company', N'division')),
  division_code      NVARCHAR(40) NULL CONSTRAINT fk_meeting_division REFERENCES pulse.division (code),
  review_week        DATE NOT NULL,                 -- the Scorecard week the meeting reviews
  status             NVARCHAR(10) NOT NULL CONSTRAINT df_meeting_status DEFAULT (N'live')
                     CONSTRAINT ck_meeting_status CHECK (status IN (N'live', N'ended')),
  section            NVARCHAR(20) NOT NULL CONSTRAINT df_meeting_section DEFAULT (N'segue')
                     CONSTRAINT ck_meeting_section CHECK (section IN (N'segue', N'scorecard', N'rocks', N'headlines', N'todos', N'ids', N'conclude')),
  section_started_at DATETIME2(3) NOT NULL CONSTRAINT df_meeting_section_at DEFAULT (SYSUTCDATETIME()),
  section_log        NVARCHAR(2000) NOT NULL CONSTRAINT df_meeting_log DEFAULT (N'[]'),   -- [{ s, at }] each section's start
  started_at         DATETIME2(3) NOT NULL CONSTRAINT df_meeting_started DEFAULT (SYSUTCDATETIME()),
  started_by_name    NVARCHAR(200) NOT NULL,
  facilitator_name   NVARCHAR(200) NOT NULL,
  facilitator_oid    NVARCHAR(64)  NOT NULL,
  notes              NVARCHAR(MAX) NULL,           -- the scribe's notes
  cascading          NVARCHAR(4000) NULL,          -- cascading messages, agreed at conclude
  ended_at           DATETIME2(3) NULL,
  ended_by_name      NVARCHAR(200) NULL,
  summary_json       NVARCHAR(MAX) NULL,           -- what happened, taken when the meeting ends
  version            INT NOT NULL CONSTRAINT df_meeting_version DEFAULT (1)
);
CREATE INDEX ix_meeting_team ON pulse.meeting (level, division_code, status, started_at);
-- One live meeting per team at a time.
CREATE UNIQUE INDEX ux_meeting_live ON pulse.meeting (level, division_code) WHERE status = N'live';
GO

CREATE TABLE pulse.meeting_attendee (
  id             INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_meeting_attendee PRIMARY KEY,
  meeting_id     INT NOT NULL CONSTRAINT fk_attendee_meeting REFERENCES pulse.meeting (id),
  name           NVARCHAR(200) NOT NULL,
  email          NVARCHAR(320) NULL,
  person_oid     NVARCHAR(64)  NULL,
  expected       BIT NOT NULL CONSTRAINT df_attendee_expected DEFAULT (0),   -- in the leadership team
  present        BIT NOT NULL CONSTRAINT df_attendee_present DEFAULT (0),
  joined_at      DATETIME2(3) NULL,
  last_seen_at   DATETIME2(3) NULL,                                          -- has the meeting open in Pulse
  rating         TINYINT NULL CONSTRAINT ck_attendee_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 10),
  rating_note    NVARCHAR(500) NULL,
  rated_by_name  NVARCHAR(200) NULL,
  CONSTRAINT uq_attendee UNIQUE (meeting_id, name)
);
GO

-- Headlines: short good or bad news about customers and employees, shared in the meeting.
-- Added any time during the week; shared_meeting_id is set when the meeting they were shared in ends.
CREATE TABLE pulse.headline (
  id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_headline PRIMARY KEY,
  level              NVARCHAR(20) NOT NULL CONSTRAINT ck_headline_level CHECK (level IN (N'company', N'division')),
  division_code      NVARCHAR(40) NULL CONSTRAINT fk_headline_division REFERENCES pulse.division (code),
  kind               NVARCHAR(20) NOT NULL CONSTRAINT ck_headline_kind CHECK (kind IN (N'customer', N'employee', N'other')),
  text               NVARCHAR(500) NOT NULL,
  by_name            NVARCHAR(200) NOT NULL,
  by_oid             NVARCHAR(64)  NOT NULL,
  created_at         DATETIME2(3) NOT NULL CONSTRAINT df_headline_created DEFAULT (SYSUTCDATETIME()),
  shared_meeting_id  INT NULL CONSTRAINT fk_headline_meeting REFERENCES pulse.meeting (id),
  issue_id           INT NULL CONSTRAINT fk_headline_issue REFERENCES pulse.issue (id),
  is_deleted         BIT NOT NULL CONSTRAINT df_headline_deleted DEFAULT (0)
);
CREATE INDEX ix_headline_open ON pulse.headline (level, division_code, shared_meeting_id);
GO

-- Issues raised in a meeting point back at what they came from.
ALTER TABLE pulse.issue ADD source_kind NVARCHAR(20) NULL, source_id INT NULL;   -- measurable, rock, headline, todo
GO
