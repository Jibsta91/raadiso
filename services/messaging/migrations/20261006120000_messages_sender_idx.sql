-- migrate:up
-- The console's account page counts a person's sent messages and finds their last one; account export
-- and erasure (GDPR) will look messages up by sender too. Without this, each is a full scan.
CREATE INDEX messages_sender_idx ON messages (sender_id, created_at DESC);

-- migrate:down
DROP INDEX messages_sender_idx;
