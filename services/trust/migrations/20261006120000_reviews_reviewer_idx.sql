-- migrate:up
-- Reviews a person wrote: the console's review search ("by" a user) and, later, account export and
-- erasure (GDPR). Only reviews about someone (subject_id) had an index.
CREATE INDEX reviews_reviewer_idx ON reviews (reviewer_id, created_at DESC);

-- migrate:down
DROP INDEX reviews_reviewer_idx;
