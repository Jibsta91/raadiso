# Trust: reviews and BankID verification

The trust service ([ADR-0018](../adr/0018-reviews-and-trust.md)) owns reviews and identity verification.
Dashboard: **Raadi · Marketplace**, panels "Reviews by outcome" and "Identity verifications by outcome".

## Verification fails for everyone

Symptoms: users land on `/…/account?verification=failed`, and the "failed" series grows.

1. Check the logs: `docker compose logs trust --since 30m | grep -i bankid`. The circuit breakers are
   `bankid-discovery` and `bankid-code-grant`.
2. Check discovery from inside the network (the trust image is distroless, so use a service that has curl,
   such as kafka-connect):

   ```bash
   # Development (mock realm); in production use your provider's issuer URL.
   docker compose exec kafka-connect \
     curl -s http://keycloak:8080/realms/bankid-mock/.well-known/openid-configuration | head -c 300
   ```

   The `issuer` must equal `BANKID_ISSUER` exactly. A mismatch (trailing slash, http vs https) fails every
   verification.

3. Development (mock): `docker compose run --rm keycloak-init` recreates the `bankid-mock` realm and
   resets its client secret.
4. Production: check the provider's status page and that the client secret in OpenBao
   (`raadi/trust`, key `bankid_client_secret`) matches the one the provider issued.

Reviews and profiles keep working while BankID is down.

## "taken": a user says their BankID is linked to someone else

Each BankID identity can verify one Raadi account (an HMAC of the provider subject is unique). The usual
cause is a second account of the same person. Ask them to remove the verification on the other account
(account page → "Remove verification"). Support cannot see who the other account is: the hash cannot be
reversed, which is by design.

## A review breaks the rules

Sign in as a moderator or platform admin, open the reviewed user's profile (`/users/<id>`), and use
"Remove review". The review stays recorded (removed by moderator), so the same deal cannot be reviewed
again. The removal is written to the audit log as `review.remove` ([audit.md](audit.md)).

## A user cannot review after a sale

`GET /api/v1/trust/eligibility?listingId=…&subjectId=…` (signed in as that user) gives the reason:

| Reason            | Meaning                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `no_conversation` | One of the two never wrote to the other about this listing                                                    |
| `not_sold`        | The listing is not marked sold (or was relisted)                                                              |
| `window_closed`   | More than `REVIEW_WINDOW_DAYS` (30) since the sale                                                            |
| `unknown_listing` | Trust has not seen the listing: check consumer lag for group `trust` ([event-pipeline.md](event-pipeline.md)) |
| `not_party`       | Neither, or both, of the two is the seller                                                                    |
