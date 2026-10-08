-- migrate:up
-- Countries and money in minor units (ADR-0040). Everything saved so far is Norwegian (demo data):
-- favourited listings were priced in whole kroner, and saved searches searched Norway.
ALTER TABLE listings
    ADD COLUMN country     text,
    ADD COLUMN price_minor bigint,
    ADD COLUMN currency    text;
UPDATE listings
   SET country     = 'NO',
       price_minor = price_nok * 100,
       currency    = CASE WHEN price_nok IS NULL THEN NULL ELSE 'NOK' END;
ALTER TABLE listings
    ALTER COLUMN country SET NOT NULL,
    DROP COLUMN price_nok;
ALTER TABLE listings RENAME COLUMN county TO region;

-- A saved search keeps its country; `county` is now `region`.
UPDATE saved_searches
   SET params = (params - 'county')
                || CASE WHEN params ? 'county' THEN jsonb_build_object('region', params -> 'county') ELSE '{}'::jsonb END
                || CASE WHEN params ? 'country' THEN '{}'::jsonb ELSE '{"country": "NO"}'::jsonb END;

-- migrate:down
UPDATE saved_searches
   SET params = (params - 'region' - 'country')
                || CASE WHEN params ? 'region' THEN jsonb_build_object('county', params -> 'region') ELSE '{}'::jsonb END;
ALTER TABLE listings RENAME COLUMN region TO county;
ALTER TABLE listings ADD COLUMN price_nok bigint;
UPDATE listings SET price_nok = price_minor / 100 WHERE currency = 'NOK';
ALTER TABLE listings DROP COLUMN currency, DROP COLUMN price_minor, DROP COLUMN country;
