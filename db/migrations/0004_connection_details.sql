-- =============================================================================
-- 0004 Connections page (Pulse 0.5.1): who last changed each credential.
-- Values never touch SQL; this is metadata only. Full history is in pulse.audit_event.
-- =============================================================================
ALTER TABLE pulse.connection_status ADD updated_by NVARCHAR(200) NULL;
GO
