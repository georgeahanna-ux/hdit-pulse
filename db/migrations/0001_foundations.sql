-- =============================================================================
-- 0001 Foundations (Pulse 0.4.0)
-- Schema, database roles, people, audit trail, sync runs, connection status, settings.
--
-- Rules for every migration:
--   * Never edit a migration once it has run anywhere; add a new numbered file.
--   * Tables people edit are system-versioned (temporal) so every change is kept (D6).
--   * pulse.audit_event is append-only for the app roles (no UPDATE or DELETE).
-- Batches are separated by lines containing only GO. Each file runs in one transaction.
-- =============================================================================

IF SCHEMA_ID(N'pulse') IS NULL EXEC (N'CREATE SCHEMA pulse AUTHORIZATION dbo');
GO

-- ---------------------------------------------------------------------------
-- Database roles. The Function identities are added to these by scripts/migrate.js.
-- ---------------------------------------------------------------------------
IF DATABASE_PRINCIPAL_ID(N'pulse_api') IS NULL CREATE ROLE pulse_api AUTHORIZATION dbo;
IF DATABASE_PRINCIPAL_ID(N'pulse_sync') IS NULL CREATE ROLE pulse_sync AUTHORIZATION dbo;
GO

-- ---------------------------------------------------------------------------
-- People (D10). One row per person, keyed by Entra object id.
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.person (
  id              INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_person PRIMARY KEY,
  entra_oid       NVARCHAR(64)  NOT NULL CONSTRAINT uq_person_oid UNIQUE,
  display_name    NVARCHAR(200) NOT NULL,
  email           NVARCHAR(320) NULL,
  is_active       BIT NOT NULL CONSTRAINT df_person_active DEFAULT (1),
  created_at      DATETIME2(3) NOT NULL CONSTRAINT df_person_created DEFAULT (SYSUTCDATETIME()),
  valid_from      DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to        DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.person_history));
GO

-- Sign-in times change constantly, so they're kept apart from the versioned person row.
CREATE TABLE pulse.person_activity (
  person_id         INT NOT NULL CONSTRAINT pk_person_activity PRIMARY KEY
                    CONSTRAINT fk_person_activity_person REFERENCES pulse.person (id),
  first_sign_in_at  DATETIME2(3) NOT NULL,
  last_sign_in_at   DATETIME2(3) NOT NULL
);
GO

-- ---------------------------------------------------------------------------
-- Audit trail (D8). Append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.audit_event (
  id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_audit_event PRIMARY KEY,
  occurred_at  DATETIME2(3) NOT NULL CONSTRAINT df_audit_at DEFAULT (SYSUTCDATETIME()),
  actor_oid    NVARCHAR(64)   NOT NULL,
  actor_name   NVARCHAR(200)  NOT NULL CONSTRAINT df_audit_actor_name DEFAULT (N''),
  action       NVARCHAR(100)  NOT NULL,
  entity_type  NVARCHAR(50)   NULL,
  entity_id    NVARCHAR(100)  NULL,
  before_json  NVARCHAR(MAX)  NULL,
  after_json   NVARCHAR(MAX)  NULL,
  reason       NVARCHAR(1000) NULL,
  client_ip    NVARCHAR(64)   NULL,
  user_agent   NVARCHAR(300)  NULL,
  component    NVARCHAR(20)   NOT NULL CONSTRAINT df_audit_component DEFAULT (N'api')
);
CREATE INDEX ix_audit_at ON pulse.audit_event (occurred_at DESC);
CREATE INDEX ix_audit_actor ON pulse.audit_event (actor_oid, occurred_at DESC);
CREATE INDEX ix_audit_entity ON pulse.audit_event (entity_type, entity_id) WHERE entity_type IS NOT NULL;
GO

-- ---------------------------------------------------------------------------
-- Background jobs (sync app): one row per run.
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.sync_run (
  id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_sync_run PRIMARY KEY,
  job          NVARCHAR(100) NOT NULL,
  started_at   DATETIME2(3)  NOT NULL,
  finished_at  DATETIME2(3)  NULL,
  ok           BIT NULL,
  detail       NVARCHAR(2000) NULL
);
CREATE INDEX ix_sync_run_job ON pulse.sync_run (job, started_at DESC);
GO

-- ---------------------------------------------------------------------------
-- Integration connections (D7). Metadata only: never a credential value.
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.connection_status (
  name               NVARCHAR(100)  NOT NULL CONSTRAINT pk_connection_status PRIMARY KEY,
  description        NVARCHAR(300)  NULL,
  configured         BIT NOT NULL CONSTRAINT df_conn_configured DEFAULT (0),
  secret_updated_at  DATETIME2(3)   NULL,
  owner              NVARCHAR(200)  NULL,
  rotation_due       DATE           NULL,
  last_checked_at    DATETIME2(3)   NULL,
  last_success_at    DATETIME2(3)   NULL,
  last_error         NVARCHAR(1000) NULL
);
GO

-- ---------------------------------------------------------------------------
-- Settings (small key/value, versioned).
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.app_setting (
  [key]        NVARCHAR(100) NOT NULL CONSTRAINT pk_app_setting PRIMARY KEY,
  [value]      NVARCHAR(MAX) NULL,
  updated_by   NVARCHAR(200) NULL,
  valid_from   DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to     DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.app_setting_history));
GO

-- ---------------------------------------------------------------------------
-- Permissions. Both app roles read and write the pulse schema; neither can alter it,
-- and neither can change or remove audit events.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::pulse TO pulse_api;
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::pulse TO pulse_sync;
DENY UPDATE, DELETE ON pulse.audit_event TO pulse_api;
DENY UPDATE, DELETE ON pulse.audit_event TO pulse_sync;
GO
