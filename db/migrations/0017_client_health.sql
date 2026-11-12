-- 0017 Client health and the Early Warning (0.10.0, D23).
-- Clients are companies with a recurring contract in force. Their feedback comes from SimpleSAT
-- (matched by the Autotask ticket it was about) and their ticket signals from Autotask. Pulse
-- works out an Early Warning score with its reasons, and a happiness score for the leaderboards.
--
-- Personal data kept (ISO 27001 A.5.34): the client contact's name and comment on each rating,
-- and the technician's name, so the Account Manager can follow up. No email addresses. Ratings are
-- kept 400 days and then deleted by the nightly job. Only Leadership, Sales & Marketing and
-- Managed Services can see them.

-- One row per client (current snapshot). is_current = 0 once their recurring contracts end.
CREATE TABLE pulse.client (
  company_id         INT            NOT NULL CONSTRAINT pk_client PRIMARY KEY,   -- Autotask company id
  name               NVARCHAR(200)  NOT NULL,
  owner_resource_id  INT            NULL,      -- Autotask Account Manager (the company's owner resource)
  owner_name         NVARCHAR(200)  NULL,
  owner_email        NVARCHAR(320)  NULL,
  mrr                DECIMAL(12,2)  NULL,
  seats              INT            NULL,
  contracts          INT            NULL,
  contract_end       DATE           NULL,      -- soonest end of a live recurring contract
  risk_score         INT            NOT NULL CONSTRAINT df_client_score DEFAULT (0),
  risk_level         NVARCHAR(10)   NOT NULL CONSTRAINT df_client_level DEFAULT (N'healthy')
                       CONSTRAINT ck_client_level CHECK (risk_level IN (N'healthy', N'watch', N'risk')),
  reasons_json       NVARCHAR(MAX)  NULL,
  happiness          DECIMAL(5,1)   NULL,
  ratings            INT            NOT NULL CONSTRAINT df_client_ratings DEFAULT (0),
  ranked             BIT            NOT NULL CONSTRAINT df_client_ranked DEFAULT (0),
  csat_pct           DECIMAL(5,1)   NULL,
  csat_n             INT            NOT NULL CONSTRAINT df_client_csatn DEFAULT (0),
  nps                INT            NULL,
  nps_n              INT            NOT NULL CONSTRAINT df_client_npsn DEFAULT (0),
  last_feedback_at   DATETIME2(0)   NULL,
  tickets_30         INT            NOT NULL CONSTRAINT df_client_t30 DEFAULT (0),
  tickets_base       DECIMAL(6,1)   NOT NULL CONSTRAINT df_client_tbase DEFAULT (0),
  sla_missed_30      INT            NOT NULL CONSTRAINT df_client_sla DEFAULT (0),
  critical_30        INT            NOT NULL CONSTRAINT df_client_crit DEFAULT (0),
  aged_open          INT            NOT NULL CONSTRAINT df_client_aged DEFAULT (0),
  is_current         BIT            NOT NULL CONSTRAINT df_client_current DEFAULT (1),
  computed_at        DATETIME2(3)   NOT NULL CONSTRAINT df_client_computed DEFAULT (SYSUTCDATETIME())
);
GO
CREATE INDEX ix_client_owner ON pulse.client (owner_email) WHERE is_current = 1;
GO

-- One row per CSAT or NPS rating from SimpleSAT (a response with both has two rows).
CREATE TABLE pulse.client_feedback (
  feedback_key    NVARCHAR(60)   NOT NULL CONSTRAINT pk_client_feedback PRIMARY KEY,   -- "<response id>:<csat|nps>"
  response_id     NVARCHAR(40)   NOT NULL,
  company_id      INT            NULL,       -- NULL: not matched to a client
  matched_by      NVARCHAR(10)   NULL CONSTRAINT ck_feedback_match CHECK (matched_by IN (N'ticket', N'contact', N'name')),
  metric          NVARCHAR(10)   NOT NULL CONSTRAINT ck_feedback_metric CHECK (metric IN (N'csat', N'nps')),
  rating          INT            NULL,
  sentiment       NVARCHAR(10)   NULL,
  comment         NVARCHAR(1000) NULL,
  topics          NVARCHAR(400)  NULL,
  contact_name    NVARCHAR(200)  NULL,
  team_member     NVARCHAR(200)  NULL,
  ticket_number   NVARCHAR(30)   NULL,
  ticket_subject  NVARCHAR(300)  NULL,
  company_text    NVARCHAR(200)  NULL,       -- the company name SimpleSAT holds (to check matching)
  answered_at     DATETIME2(0)   NOT NULL
);
GO
CREATE INDEX ix_feedback_company ON pulse.client_feedback (company_id, answered_at DESC);
GO

-- Weekly snapshot for the trend (Monday of the Sydney week).
CREATE TABLE pulse.client_week (
  company_id  INT          NOT NULL,
  week        DATE         NOT NULL,
  risk_score  INT          NOT NULL,
  happiness   DECIMAL(5,1) NULL,
  CONSTRAINT pk_client_week PRIMARY KEY (company_id, week)
);
GO

-- Account Managers' follow-up notes on a client.
CREATE TABLE pulse.client_note (
  id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_client_note PRIMARY KEY,
  company_id   INT            NOT NULL,
  note         NVARCHAR(2000) NOT NULL,
  author_oid   NVARCHAR(64)   NOT NULL,
  author_name  NVARCHAR(200)  NOT NULL,
  created_at   DATETIME2(3)   NOT NULL CONSTRAINT df_client_note_at DEFAULT (SYSUTCDATETIME())
);
GO
CREATE INDEX ix_client_note_company ON pulse.client_note (company_id, created_at DESC);
GO
