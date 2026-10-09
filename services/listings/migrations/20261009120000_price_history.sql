-- migrate:up
-- Price history and drops (ADR-0044). Every price a listing has had, and on the listing its last drop
-- (the price before, and when), until the price goes up again. Prices are not personal data.
CREATE TABLE price_history (
    listing_id  uuid        NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    price_minor bigint      CHECK (price_minor >= 0),
    currency    text        CHECK (currency ~ '^[A-Z]{3}$'),
    changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_history_listing_idx ON price_history (listing_id, changed_at DESC);
INSERT INTO price_history (listing_id, price_minor, currency, changed_at)
     SELECT id, price_minor, currency, published_at FROM listings;

ALTER TABLE listings
    ADD COLUMN previous_price_minor bigint CHECK (previous_price_minor >= 0),
    ADD COLUMN price_dropped_at     timestamptz;

-- migrate:down
ALTER TABLE listings DROP COLUMN price_dropped_at, DROP COLUMN previous_price_minor;
DROP TABLE price_history;
