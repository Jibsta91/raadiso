-- migrate:up
-- Every report about a listing, handled or not (the console's listing page shows its history). The
-- existing listing index covers open reports only.
CREATE INDEX reports_listing_idx ON reports (listing_id, created_at DESC);

-- migrate:down
DROP INDEX reports_listing_idx;
