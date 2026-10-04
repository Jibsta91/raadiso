-- migrate:up
-- Append-only audit log of staff actions (ADR-0028). Entries come from the
-- audit events every service writes with the action itself.
CREATE TABLE audit_entries (
    action_id    uuid PRIMARY KEY,
    actor_id     uuid        NOT NULL,
    actor_roles  text[]      NOT NULL,
    action       text        NOT NULL,
    target_type  text        NOT NULL,
    target_id    text        NOT NULL,
    reason       text,
    source       text        NOT NULL,
    at           timestamptz NOT NULL,
    recorded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_at_idx ON audit_entries (at DESC);
CREATE INDEX audit_actor_idx ON audit_entries (actor_id, at DESC);
CREATE INDEX audit_target_idx ON audit_entries (target_type, target_id, at DESC);
CREATE INDEX audit_action_idx ON audit_entries (action, at DESC);

-- Append-only: rows can be added, never changed or removed (not even by this service).
CREATE FUNCTION audit_entries_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit entries are append-only';
END $$;
CREATE TRIGGER audit_entries_no_update BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_immutable();
CREATE TRIGGER audit_entries_no_truncate BEFORE TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_immutable();

-- migrate:down
DROP TABLE audit_entries;
DROP FUNCTION audit_entries_immutable();
