-- migrate:up
-- Seller tools (ADR-0045): how often a listing was viewed (a counter only: no viewer, cookie or IP is
-- stored) and when it was last renewed (moved back to the top, at most once a week).
ALTER TABLE listings
    ADD COLUMN views      integer     NOT NULL DEFAULT 0 CHECK (views >= 0),
    ADD COLUMN renewed_at timestamptz;

-- migrate:down
ALTER TABLE listings DROP COLUMN renewed_at, DROP COLUMN views;
