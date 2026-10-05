-- migrate:up
-- Public profiles exist for every seller trust knows, not only for reviewed people.
CREATE INDEX listings_owner_idx ON listings (owner_id);

-- migrate:down
DROP INDEX listings_owner_idx;
