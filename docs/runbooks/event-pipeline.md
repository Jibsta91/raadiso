# Event pipeline (outbox → Debezium → Kafka → consumers)

**Alerts:** `DeadLettersGrowing`, `ConsumerLagHigh`, `ConsumerGroupEmpty`, `SearchIndexLagHigh`,
`EmailQueueBacklog`, `EmailsGivenUp`.
**Severity:** warning/critical. **Dashboard:** Grafana → Raadi → _Marketplace_.

Background: [ADR-0012](../adr/0012-event-backbone.md). Services write events to their `outbox` table, Debezium
publishes them to `raadi.<aggregate>.events`, and the consumers process them: search (`search-indexer`),
media (`media-listing-sync`), notifications, trust, saved, audit and listings. Events a consumer can never process go to `raadi.dlq`.

1. **Admin credentials for the Kafka CLI** (written to the container's tmpfs, gone on restart):
   ```bash
   docker compose exec kafka bash -c 'umask 077; printf "security.protocol=SASL_PLAINTEXT\nsasl.mechanism=SCRAM-SHA-512\nsasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required username=\"admin\" password=\"%s\";\n" "$(cat /run/secrets/raadi/kafka_admin_password)" > /tmp/admin.properties'
   ```
2. **Consumer lag and members** (`ConsumerLagHigh`, `ConsumerGroupEmpty`):
   ```bash
   docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
     --command-config /tmp/admin.properties --describe --all-groups | grep -vE '^$'
   ```
   No members: the consuming service is down or crash-looping. Follow [service-down.md](service-down.md).
   Members but growing lag: the consumer is retrying a transient error (it retries in place to keep ordering).
   Its logs say which dependency fails: `docker compose logs --tail=100 search` (OpenSearch) or `media`
   (PostgreSQL, OpenFGA).
3. **Dead letters** (`DeadLettersGrowing`). Read the newest ones. The headers carry the error and the
   source topic, partition, offset and consumer group (`dlq.*` headers):
   ```bash
   docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 \
     --consumer.config /tmp/admin.properties --topic raadi.dlq --from-beginning \
     --property print.headers=true --max-messages 20 --timeout-ms 10000
   ```
   A dead letter is either a producer bug (the event violates its contract: fix the producer, which also
   fails its contract tests) or a reference to something that no longer exists (usually harmless). After a
   fix, replay by re-publishing the payloads to the original topic. Consumers are idempotent, so a replay
   is safe.
4. **Nothing arrives at all** (lag 0, but listings do not appear in search): check the Debezium connectors.
   ```bash
   docker compose exec kafka-connect curl -s 'http://localhost:8083/connectors?expand=status' \
     | jq -c 'to_entries[] | {name: .key, tasks: [.value.status.tasks[] | {state, trace: (.trace // "" | .[0:300])}]}'
   docker compose run --rm connect-init      # re-applies the config and restarts failed tasks
   ```
   A replication slot whose connector is down holds WAL in PostgreSQL. Check `pg_replication_slots` if the
   disk fills up.
5. **Rebuild the search index** (mapping change): bump `INDEX_VERSION` in
   `services/search/src/search/index-definition.ts` and redeploy search. On start it creates the new index,
   copies the documents from the old one and moves the alias atomically. If the new mapping needs data the
   stored documents lack, or the index is corrupted, re-read the topic instead (events are kept 14 days):
   ```bash
   docker compose stop search
   docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
     --command-config /tmp/admin.properties --group search-indexer --topic raadi.listing.events \
     --reset-offsets --to-earliest --execute
   docker compose up -d search
   ```
6. **E-mail backlog** (`EmailQueueBacklog`, `EmailsGivenUp`). The notifications service queues e-mails
   and sends them in a loop ([ADR-0017](../adr/0017-notifications.md)). The last error is on each row:
   ```bash
   docker compose exec postgres psql -U postgres -d notifications -c \
     "SELECT kind, status, attempts, left(last_error, 80) FROM emails WHERE status <> 'sent' ORDER BY created_at DESC LIMIT 20"
   docker compose logs --tail=100 notifications
   ```
   Typical causes: the mail server refuses or is unreachable (check `SMTP_*`), or Keycloak's users API fails
   (service account `notifications` needs `realm-management/view-users`; `docker compose run --rm keycloak-init`
   re-grants it). E-mails that `failed` can be re-queued once the cause is fixed:
   `UPDATE emails SET status = 'pending', attempts = 0, next_attempt_at = now() WHERE status = 'failed';`
7. **Verify:** the Marketplace dashboard shows lag back at 0, and `./raadi smoke` passes (development).
