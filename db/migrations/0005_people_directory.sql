-- =============================================================================
-- 0005 People directory and Autotask departments (Pulse 0.5.2; D10, D16)
-- Entra users (from Microsoft Graph, nightly) and Autotask resources, departments, roles and
-- resource-role-department pairings (every 15 minutes). People are linked to their Autotask
-- resource by email; anything unclear goes to the Needs review list for Platform Admins.
-- Autotask tables keep their history (temporal), so past weeks can use the department in
-- force at the time (D16).
-- =============================================================================

ALTER TABLE pulse.person ADD
  upn            NVARCHAR(320) NULL,
  emails_json    NVARCHAR(2000) NULL,      -- every address from Entra, lower case
  job_title      NVARCHAR(200) NULL,
  entra_department NVARCHAR(200) NULL,
  account_enabled BIT NULL,
  is_licensed    BIT NULL,
  source         NVARCHAR(20) NULL;        -- 'signin' or 'entra'
GO

-- ---------------------------------------------------------------------------
-- Autotask copies (refreshed by the sync service; values change only when Autotask does)
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.at_department (
  id          INT NOT NULL CONSTRAINT pk_at_department PRIMARY KEY,
  name        NVARCHAR(200) NOT NULL,
  is_active   BIT NOT NULL CONSTRAINT df_at_department_active DEFAULT (1),
  valid_from  DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to    DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.at_department_history));
GO

CREATE TABLE pulse.at_role (
  id          INT NOT NULL CONSTRAINT pk_at_role PRIMARY KEY,
  name        NVARCHAR(200) NOT NULL,
  is_active   BIT NOT NULL CONSTRAINT df_at_role_active DEFAULT (1)
);
GO

CREATE TABLE pulse.at_resource (
  id                     INT NOT NULL CONSTRAINT pk_at_resource PRIMARY KEY,
  first_name             NVARCHAR(100) NULL,
  last_name              NVARCHAR(100) NULL,
  email                  NVARCHAR(320) NULL,
  email2                 NVARCHAR(320) NULL,
  email3                 NVARCHAR(320) NULL,
  user_name              NVARCHAR(200) NULL,
  title                  NVARCHAR(200) NULL,
  license_type           INT NULL,
  is_active              BIT NOT NULL,
  default_department_id  INT NULL,
  default_role_id        INT NULL,
  valid_from  DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to    DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.at_resource_history));
CREATE INDEX ix_at_resource_email ON pulse.at_resource (email);
GO

CREATE TABLE pulse.at_resource_role_department (
  id                 BIGINT NOT NULL CONSTRAINT pk_at_rrd PRIMARY KEY,
  resource_id        INT NOT NULL,
  department_id      INT NOT NULL,
  role_id            INT NOT NULL,
  is_default         BIT NOT NULL,
  is_active          BIT NOT NULL,
  is_department_lead BIT NOT NULL CONSTRAINT df_at_rrd_lead DEFAULT (0)
);
CREATE INDEX ix_at_rrd_resource ON pulse.at_resource_role_department (resource_id);
GO

-- ---------------------------------------------------------------------------
-- Links from a person to their account in each system (D10). One per system per person,
-- and an external account can belong to only one person.
-- ---------------------------------------------------------------------------
CREATE TABLE pulse.person_link (
  person_id      INT NOT NULL CONSTRAINT fk_link_person REFERENCES pulse.person (id),
  system         NVARCHAR(30) NOT NULL,         -- 'autotask' (later: 'dattormm', 'itglue', 'simplesat', 'quotemanager')
  external_id    NVARCHAR(100) NOT NULL,
  source         NVARCHAR(20) NOT NULL CONSTRAINT ck_link_source CHECK (source IN (N'email', N'admin')),
  matched_email  NVARCHAR(320) NULL,
  linked_by      NVARCHAR(200) NULL,
  reason         NVARCHAR(1000) NULL,
  valid_from  DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  valid_to    DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
  PERIOD FOR SYSTEM_TIME (valid_from, valid_to),
  CONSTRAINT pk_person_link PRIMARY KEY (person_id, system),
  CONSTRAINT uq_person_link_external UNIQUE (system, external_id)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = pulse.person_link_history));
GO

-- Admin decision that a person has no account in a system (stops them showing in Needs review).
CREATE TABLE pulse.person_link_none (
  person_id   INT NOT NULL CONSTRAINT fk_link_none_person REFERENCES pulse.person (id),
  system      NVARCHAR(30) NOT NULL,
  set_by      NVARCHAR(200) NOT NULL,
  reason      NVARCHAR(1000) NOT NULL,
  set_at      DATETIME2(3) NOT NULL CONSTRAINT df_link_none_at DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT pk_person_link_none PRIMARY KEY (person_id, system)
);
GO

-- Rebuilt by each matching run: what a Platform Admin needs to look at.
CREATE TABLE pulse.directory_review (
  id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_directory_review PRIMARY KEY,
  system       NVARCHAR(30) NOT NULL,
  kind         NVARCHAR(30) NOT NULL,     -- no_match, multiple, conflict, unlinked_account
  person_id    INT NULL,
  external_ids NVARCHAR(400) NULL,
  detail       NVARCHAR(500) NULL,
  found_at     DATETIME2(3) NOT NULL CONSTRAINT df_review_at DEFAULT (SYSUTCDATETIME())
);
GO

-- Ask the sync service to run a job now (the API can't run jobs that need the sync identity).
CREATE TABLE pulse.sync_request (
  id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_sync_request PRIMARY KEY,
  job           NVARCHAR(100) NOT NULL,
  requested_by  NVARCHAR(200) NOT NULL,
  requested_at  DATETIME2(3) NOT NULL CONSTRAINT df_sync_request_at DEFAULT (SYSUTCDATETIME()),
  picked_at     DATETIME2(3) NULL
);
GO
