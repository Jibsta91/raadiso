#!/usr/bin/env bash
# kafka-init: idempotent Kafka topology. SCRAM users (one per client, password
# from the secrets mount), topics, and least-privilege ACLs. Runs on every `up`.
set -euo pipefail
S="${SECRETS_PATH:-/run/secrets/raadi}"
BIN=/opt/kafka/bin
BOOTSTRAP=kafka:9092
export KAFKA_HEAP_OPTS="-Xms32m -Xmx128m" KAFKA_OPTS="-XX:TieredStopAtLevel=1 -Xshare:auto"
log() { printf '{"time":"%s","level":"info","task":"kafka-init","msg":"%s"}\n' "$(date -u +%FT%TZ)" "$*"; }

umask 077
ADMIN=/tmp/admin.properties
cat > "$ADMIN" <<PROPS
security.protocol=SASL_PLAINTEXT
sasl.mechanism=SCRAM-SHA-512
sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required username="admin" password="$(cat "$S/kafka_admin_password")";
PROPS

cluster=""
for i in $(seq 1 30); do
  cluster="$("$BIN/kafka-cluster.sh" cluster-id --bootstrap-server "$BOOTSTRAP" --config "$ADMIN" 2>/dev/null)" && break
  [[ $i == 30 ]] && { echo "kafka not reachable" >&2; exit 1; }
  sleep 2
done

# Every CLI call starts a JVM (seconds each). Skip the work when this script,
# the passwords and the cluster are unchanged since the last successful run.
STATE=/state/applied
fingerprint="$( { cat "$0" "$S"/kafka_*_password; echo "$cluster"; } | sha256sum | cut -d' ' -f1)"
if [[ -f "$STATE" && "$(cat "$STATE")" == "$fingerprint" ]]; then
  log "topology unchanged, nothing to do"
  exit 0
fi

# --- Users ------------------------------------------------------------------
# One SCRAM principal per client. Passwords are re-applied on every run, so a
# rotated secret takes effect on the next `up`.
users=(connect search media notifications trust listings saved audit monitor)
for u in "${users[@]}"; do
  "$BIN/kafka-configs.sh" --bootstrap-server "$BOOTSTRAP" --command-config "$ADMIN" --alter \
    --add-config "SCRAM-SHA-512=[iterations=8192,password=$(cat "$S/kafka_${u}_password")]" \
    --entity-type users --entity-name "$u" >/dev/null
done
log "SCRAM users ready: ${users[*]}"

# --- Topics -----------------------------------------------------------------
# <name> <partitions> <extra config>. Event topics are keyed by aggregate id,
# so per-aggregate ordering holds within a partition.
topics=(
  "raadi.user.events 3 retention.ms=1209600000"
  "raadi.listing.events 3 retention.ms=1209600000"
  "raadi.media.events 3 retention.ms=1209600000"
  "raadi.conversation.events 3 retention.ms=1209600000"
  "raadi.review.events 3 retention.ms=1209600000"
  "raadi.payment.events 3 retention.ms=1209600000"
  "raadi.promotion.events 3 retention.ms=1209600000"
  "raadi.alert.events 3 retention.ms=1209600000"
  "raadi.audit.events 3 retention.ms=2592000000"
  "raadi.dlq 1 retention.ms=2592000000"
  "raadi.connect.configs 1 cleanup.policy=compact"
  "raadi.connect.offsets 5 cleanup.policy=compact"
  "raadi.connect.status 3 cleanup.policy=compact"
)
existing="$("$BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" --command-config "$ADMIN" --list)"
for t in "${topics[@]}"; do
  read -r name parts cfg <<<"$t"
  grep -qx "$name" <<<"$existing" && continue
  "$BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" --command-config "$ADMIN" --create \
    --topic "$name" --partitions "$parts" --replication-factor 1 --config "$cfg" >/dev/null
  log "created topic $name"
done

# --- ACLs (adding an existing ACL is a no-op) -------------------------------
acl() { "$BIN/kafka-acls.sh" --bootstrap-server "$BOOTSTRAP" --command-config "$ADMIN" --add "$@" >/dev/null; }
# Kafka Connect (Debezium): its own internal topics and group; writes the event topics.
acl --allow-principal User:connect --operation All --resource-pattern-type prefixed \
  --topic raadi.connect. --group raadi-connect
acl --allow-principal User:connect --operation Write --operation Describe \
  --topic raadi.user.events --topic raadi.listing.events --topic raadi.media.events \
  --topic raadi.conversation.events --topic raadi.review.events --topic raadi.payment.events \
  --topic raadi.promotion.events --topic raadi.alert.events --topic raadi.audit.events
acl --allow-principal User:connect --operation Describe --cluster
# Consumers: read what they subscribe to; dead letters go to raadi.dlq.
acl --allow-principal User:search --operation Read --operation Describe \
  --topic raadi.listing.events --group search-indexer
acl --allow-principal User:media --operation Read --operation Describe \
  --topic raadi.listing.events --group media-listing-sync
acl --allow-principal User:notifications --operation Read --operation Describe \
  --topic raadi.conversation.events --topic raadi.listing.events --topic raadi.review.events \
  --topic raadi.payment.events --topic raadi.alert.events --topic raadi.user.events --group notifications
acl --allow-principal User:trust --operation Read --operation Describe \
  --topic raadi.conversation.events --topic raadi.listing.events --group trust
acl --allow-principal User:listings --operation Read --operation Describe \
  --topic raadi.promotion.events --group listings-promotions
acl --allow-principal User:saved --operation Read --operation Describe \
  --topic raadi.listing.events --group saved
acl --allow-principal User:audit --operation Read --operation Describe \
  --topic raadi.audit.events --group audit
acl --allow-principal User:search --allow-principal User:media --allow-principal User:notifications \
  --allow-principal User:trust --allow-principal User:listings --allow-principal User:saved \
  --allow-principal User:audit --operation Write --operation Describe --topic raadi.dlq
# OpenTelemetry kafkametrics receiver: describe everything, read nothing.
acl --allow-principal User:monitor --operation Describe --operation DescribeConfigs \
  --resource-pattern-type prefixed --topic raadi.
acl --allow-principal User:monitor --operation Describe --resource-pattern-type prefixed \
  --group search- --group media- --group notifications --group trust --group listings- --group saved --group audit
acl --allow-principal User:monitor --operation Describe --cluster
log "ACLs applied"

printf '%s' "$fingerprint" > "$STATE"
