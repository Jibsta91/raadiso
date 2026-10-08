-- migrate:up
-- Countries and money in minor units (ADR-0040). A listing belongs to its place's country and is priced
-- in that country's currency. Every listing so far is Norwegian (demo data), priced in whole kroner.
ALTER TABLE listings
    ADD COLUMN country     text,
    ADD COLUMN price_minor bigint CHECK (price_minor >= 0),
    ADD COLUMN currency    text   CHECK (currency ~ '^[A-Z]{3}$');
UPDATE listings
   SET country     = 'NO',
       price_minor = price_nok * 100,
       currency    = CASE WHEN price_nok IS NULL THEN NULL ELSE 'NOK' END;
ALTER TABLE listings
    ALTER COLUMN country SET NOT NULL,
    ADD CONSTRAINT listings_price_has_currency CHECK ((price_minor IS NULL) = (currency IS NULL)),
    DROP COLUMN price_nok;
CREATE INDEX listings_country_recent_idx ON listings (country, published_at DESC) WHERE status = 'active';

-- migrate:down
ALTER TABLE listings ADD COLUMN price_nok bigint CHECK (price_nok >= 0);
UPDATE listings SET price_nok = price_minor / 100 WHERE currency = 'NOK';
DROP INDEX listings_country_recent_idx;
ALTER TABLE listings
    DROP CONSTRAINT listings_price_has_currency,
    DROP COLUMN currency,
    DROP COLUMN price_minor,
    DROP COLUMN country;
