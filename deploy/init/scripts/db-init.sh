#!/usr/bin/env bash
# Creates one database + login role per service (least privilege, no access to
# other services' databases), enables required extensions and applies dbmate
# migrations. Idempotent: safe to run on every `docker compose up`.
# shellcheck source=lib.sh
source /opt/raadi/bin/lib.sh
TASK="db-init"

export PGHOST="${PGHOST:-postgres}" PGPORT="${PGPORT:-5432}" PGUSER=postgres PGDATABASE=postgres
PGPASSWORD="$(secret postgres_superuser_password)"; export PGPASSWORD
retry 30 pg_isready -q || die "postgres not ready"

psql_q() { psql -v ON_ERROR_STOP=1 -qAt "$@"; }

ensure_db() { # <db> <role> <password> <extensions...>
  local db="$1" role="$2" pw="$3"; shift 3
  psql_q -v role="$role" -v pw="$pw" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role')
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'role', :'pw')
\gexec
SQL
  psql_q -v db="$db" -v role="$role" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db')
\gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO postgres_monitor', :'db')
\gexec
SQL
  psql_q -d "$db" -v role="$role" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'role')
\gexec
SQL
  for ext in "$@"; do psql_q -d "$db" -c "CREATE EXTENSION IF NOT EXISTS \"${ext}\""; done
}

# Monitoring role used by the OpenTelemetry collector's postgresql receiver.
psql_q -v pw="$(secret postgres_monitor_password)" <<'SQL'
SELECT 'CREATE ROLE postgres_monitor LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres_monitor')
\gexec
SELECT format('ALTER ROLE postgres_monitor WITH LOGIN PASSWORD %L', :'pw')
\gexec
GRANT pg_monitor TO postgres_monitor;
SQL

for db in $(jq -r '.infraDatabases | keys[]' "$MANIFEST"); do
  owner=$(jq -r --arg d "$db" '.infraDatabases[$d].owner' "$MANIFEST")
  pw="$(secret "$(jq -r --arg d "$db" '.infraDatabases[$d].password' "$MANIFEST")")"
  mapfile -t exts < <(jq -r --arg d "$db" '.infraDatabases[$d].extensions[]' "$MANIFEST")
  ensure_db "$db" "$owner" "$pw" "${exts[@]}"
  info "database ${db} ready"
done

for svc in $(jq -r '.services | to_entries[] | select(.value.database) | .key' "$MANIFEST"); do
  db=$(jq -r --arg s "$svc" '.services[$s].database' "$MANIFEST")
  pw="$(secret "$(jq -r --arg s "$svc" '.services[$s].openbao.db_password' "$MANIFEST")")"
  mapfile -t exts < <(jq -r --arg s "$svc" '.services[$s].extensions // [] | .[]' "$MANIFEST")
  ensure_db "$db" "$db" "$pw" "${exts[@]}"

  mig="/opt/raadi/migrations/$(jq -r --arg s "$svc" '.services[$s].migrations // $s' "$MANIFEST")"
  if [[ -d "$mig" ]]; then
    DATABASE_URL="postgres://${db}:${pw}@${PGHOST}:${PGPORT}/${db}?sslmode=disable" \
      dbmate --migrations-dir "$mig" --no-dump-schema --wait up >/dev/null
    applied=$(PGPASSWORD="$pw" psql_q -U "$db" -d "$db" -c 'SELECT count(*) FROM schema_migrations')
    info "database ${db} migrated (${applied} migration(s) applied)"
  fi
done

# Change data capture (Debezium, ADR-0008): one REPLICATION role that can read
# only the outbox table of each service that publishes events. The publication
# is created here (as superuser), so the CDC role needs no table ownership. The
# heartbeat table gives an idle database WAL traffic, so its slot keeps advancing.
cdc_role="$(jq -r '.cdc.role' "$MANIFEST")"
psql_q -v role="$cdc_role" -v pw="$(secret "$(jq -r '.cdc.password' "$MANIFEST")")" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN REPLICATION', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role')
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'role', :'pw')
\gexec
SQL
for svc in $(jq -r '.services | to_entries[] | select(.value.outbox) | .key' "$MANIFEST"); do
  db=$(jq -r --arg s "$svc" '.services[$s].database' "$MANIFEST")
  psql_q -d "$db" -v db="$db" -v role="$cdc_role" <<'SQL'
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'role')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'role')
\gexec
SELECT format('GRANT SELECT ON public.outbox TO %I', :'role')
\gexec
CREATE TABLE IF NOT EXISTS public.cdc_heartbeat (id int PRIMARY KEY, beat_at timestamptz NOT NULL);
INSERT INTO public.cdc_heartbeat VALUES (1, now()) ON CONFLICT (id) DO NOTHING;
SELECT format('GRANT SELECT, UPDATE ON public.cdc_heartbeat TO %I', :'role')
\gexec
SELECT 'CREATE PUBLICATION dbz_outbox FOR TABLE public.outbox, public.cdc_heartbeat'
 WHERE NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'dbz_outbox')
\gexec
-- The heartbeat must be in the publication, or an idle database sends Debezium nothing: its slot never
-- confirms a position and holds back WAL until max_slot_wal_keep_size invalidates it. The connector
-- still captures only public.outbox (table.include.list), so heartbeats never become events.
SELECT 'ALTER PUBLICATION dbz_outbox ADD TABLE public.cdc_heartbeat'
 WHERE NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'dbz_outbox' AND schemaname = 'public' AND tablename = 'cdc_heartbeat')
\gexec
-- Outbox rows are only inserted, and heartbeats are updates. The services prune old outbox rows
-- (startEventTableJanitor); those deletes must not reach Debezium, whose outbox router would warn about
-- each one.
ALTER PUBLICATION dbz_outbox SET (publish = 'insert, update');
SQL
  info "database ${db} published for CDC (outbox)"
done
