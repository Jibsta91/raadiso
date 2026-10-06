-- migrate:up
-- The newest listing version media has applied, per listing. Listing events are applied only when they
-- are newer, so a late, redelivered or replayed event (from the dead-letter topic) cannot undo a newer
-- change to which images a listing has.
CREATE TABLE listing_versions (
    listing_id uuid PRIMARY KEY,
    version    integer NOT NULL CHECK (version >= 1)
);

-- migrate:down
DROP TABLE listing_versions;
