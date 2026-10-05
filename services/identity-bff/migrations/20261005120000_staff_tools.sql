-- migrate:up
-- The admin console's user administration (ADR-0030). Keycloak holds whether an account is
-- enabled; these tables hold why it was suspended, until when, and support's notes.
CREATE TABLE user_suspensions (
    user_id       uuid PRIMARY KEY,
    reason_code   text        NOT NULL
                              CHECK (reason_code IN ('fraud', 'spam', 'abuse', 'chargeback',
                                                     'impersonation', 'security', 'other')),
    note          text        NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    suspended_by  uuid        NOT NULL,
    suspended_at  timestamptz NOT NULL DEFAULT now(),
    -- Lifted automatically after this time (admin-bff's worker); NULL means until lifted by staff.
    until         timestamptz CHECK (until IS NULL OR until > suspended_at)
);
CREATE INDEX user_suspensions_until_idx ON user_suspensions (until) WHERE until IS NOT NULL;

-- Internal notes by support about an account (never shown to the user). Erased with the account.
CREATE TABLE user_notes (
    id          uuid PRIMARY KEY,
    user_id     uuid        NOT NULL,
    author_id   uuid        NOT NULL,
    body        text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    pinned      boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_notes_user_idx ON user_notes (user_id, created_at DESC);

-- migrate:down
DROP TABLE user_notes;
DROP TABLE user_suspensions;
