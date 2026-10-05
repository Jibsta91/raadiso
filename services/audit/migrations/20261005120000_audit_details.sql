-- migrate:up
-- What changed (ids, codes, numbers; ADR-0030). Older entries have none.
ALTER TABLE audit_entries ADD COLUMN details jsonb;

-- migrate:down
ALTER TABLE audit_entries DROP COLUMN details;
