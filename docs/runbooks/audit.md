# Audit log

Staff actions are written to the acting service's outbox together with the change, published to
`raadi.audit.events` (30 days in Kafka) and stored by the audit service in `audit_entries`, a table whose
triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` ([ADR-0028](../adr/0028-admin-console-staff-roles-and-audit.md)).
Platform admins read it in the admin console (Audit). Dashboard: **Raadi · Marketplace**, panel "Staff
actions (audit log)".

| Action            | Written by | When                                           |
| ----------------- | ---------- | ---------------------------------------------- |
| `listing.remove`  | listings   | A moderator removes a listing                  |
| `reports.dismiss` | listings   | A moderator dismisses a listing's open reports |
| `review.remove`   | trust      | A moderator or platform admin removes a review |
| `payment.refund`  | payments   | A platform admin refunds an order              |

## An action is missing from the console

The entry is written in the same transaction as the change, so it exists in the producing service's outbox.
It is late, not lost:

1. Consumer group `audit` lag and dead letters: [event-pipeline.md](event-pipeline.md).
2. The Debezium connector of the producing service: step 4 of [event-pipeline.md](event-pipeline.md).
3. The audit service itself: `docker compose logs --tail=100 audit`.

## Answering "who did this?"

Filter by target in the console (`targetType` and `targetId`), or query the table:

```bash
docker compose exec postgres psql -U postgres -d audit -c \
  "SELECT at, action, actor_id, actor_roles, reason FROM audit_entries WHERE target_id = '<id>' ORDER BY at"
```

Entries carry ids only. Look the staff member up in Keycloak (realm `raadi` → Users → search by id).

## Corrections

Entries are never changed or deleted, not even by a database superuser in the normal course of work (the
triggers would have to be dropped, which is itself visible in the PostgreSQL log). A mistaken action is
corrected by a new action, for example relisting a wrongly removed listing.
