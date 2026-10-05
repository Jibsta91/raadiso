-- migrate:up
-- Who removed a listing and why (ADR-0030): the console shows it, and a seller's history counts
-- removals by moderators. Older removals have no source.
ALTER TABLE listings ADD COLUMN removed_by text CHECK (removed_by IN ('owner', 'moderation'));
ALTER TABLE listings ADD COLUMN removal_reason text
    CHECK (removal_reason IN ('fraud', 'prohibited', 'offensive', 'wrong_category', 'duplicate',
                              'spam', 'other'));
ALTER TABLE reports ADD COLUMN handled_note text CHECK (length(handled_note) <= 500);
CREATE INDEX reports_handled_idx ON reports (handled_at DESC) WHERE status <> 'open';
CREATE INDEX listings_admin_recent_idx ON listings (created_at DESC);

-- migrate:down
DROP INDEX listings_admin_recent_idx;
DROP INDEX reports_handled_idx;
ALTER TABLE reports DROP COLUMN handled_note;
ALTER TABLE listings DROP COLUMN removal_reason;
ALTER TABLE listings DROP COLUMN removed_by;
