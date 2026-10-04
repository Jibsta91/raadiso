# Saved: favourites and saved searches

The saved service ([ADR-0026](../adr/0026-favourites-and-saved-searches.md)) keeps favourites current from
listing events (price drops, sold) and checks every saved search for new matches every
`SAVED_SEARCH_INTERVAL_SECONDS` (300) by asking search. Alerts go out as events; notifications turns them
into in-app notices, pushes and at most one e-mail a day. Dashboard: **Raadi · Marketplace**, panel
"Favourite and saved-search alerts". Alert: `SavedSearchChecksFailing`.

## Saved-search checks fail (`SavedSearchChecksFailing`)

Saved searches are checked by querying search (`SEARCH_URL`). A failed check is tried again for the same
time window on the next round, so nobody misses a match once the cause is fixed.

1. `docker compose logs --tail=100 saved | grep 'saved search check failed'` shows the error.
2. Search down or slow: follow [service-down.md](service-down.md) for `search`, and check OpenSearch's
   health on the **Data stores** dashboard.
3. Search answers `400`: a saved search holds a filter that search no longer accepts (a removed attribute
   or category). Find it, and either fix the parameters or delete it:

   ```bash
   docker compose exec postgres psql -U postgres -d saved -c \
     "SELECT id, params FROM saved_searches ORDER BY next_run_at LIMIT 20"
   ```

## Favourites do not follow price changes or sales

Favourites are updated from `raadi.listing.events` (consumer group `saved`). Check its lag and the dead
letters as described in [event-pipeline.md](event-pipeline.md).
