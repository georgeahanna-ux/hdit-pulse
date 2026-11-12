-- 0018 Ticket sentiment with Azure OpenAI (0.11.0, D23).
-- One row per client ticket Azure OpenAI has read: the result only. The ticket text sent (title,
-- description and client-visible notes, with email addresses and phone numbers removed) isn't kept;
-- text_hash is a SHA-256 of it, so a ticket is read again only when it changes. reason is one line
-- the model writes without names or contact details. Kept 120 days by the sentiment job.
CREATE TABLE pulse.ticket_sentiment (
  ticket_id      INT            NOT NULL CONSTRAINT pk_ticket_sentiment PRIMARY KEY,   -- Autotask ticket id
  company_id     INT            NOT NULL,
  ticket_number  NVARCHAR(30)   NULL,
  title          NVARCHAR(255)  NULL,
  created_at     DATETIME2(0)   NOT NULL,          -- when the ticket was created (UTC)
  text_hash      CHAR(64)       NOT NULL,
  sentiment      NVARCHAR(10)   NOT NULL CONSTRAINT ck_ts_sentiment CHECK (sentiment IN (N'positive', N'neutral', N'negative')),
  frustration    TINYINT        NOT NULL CONSTRAINT ck_ts_frustration CHECK (frustration BETWEEN 0 AND 3),
  churn          BIT            NOT NULL,
  reason         NVARCHAR(200)  NULL,
  model          NVARCHAR(60)   NULL,
  analysed_at    DATETIME2(3)   NOT NULL
);
GO
CREATE INDEX ix_ts_company ON pulse.ticket_sentiment (company_id, created_at DESC);
GO

MERGE pulse.app_setting AS t
USING (VALUES (N'sentiment.enabled', N'1')) AS s ([key], [value]) ON t.[key] = s.[key]
WHEN NOT MATCHED THEN INSERT ([key], [value], updated_by) VALUES (s.[key], s.[value], N'migration 0018');
GO
