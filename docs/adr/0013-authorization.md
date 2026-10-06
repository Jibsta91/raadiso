# 0013 — Authorization: OpenFGA relationships, OPA marketplace rules, fail closed

- Status: Accepted
- Date: 2026-10-01

## Decision

Authorization is split by kind of question:

- **Who may act on which object** is relationship-based, in **OpenFGA** (Apache-2.0, its own database). The
  model (`deploy/openfga/model.fga`) has `listing` and `media` objects with `owner` tuples written by the
  services when they create an object. Derived permissions (`can_edit`, `can_delete`,
  `can_view_hidden`, `can_attach`) are what services check. The model also has `platform:raadi` relations
  (`moderator`, `admin`); they were filled from the token as contextual tuples until 2026-10-06. Staff powers
  now go only through the console's staff APIs ([ADR-0030](0030-staff-apis-and-console-workspaces.md)),
  so the public API checks ownership alone.
- **Whether a listing may be published** is policy, in **OPA** (Apache-2.0, Rego in
  `deploy/opa/policies/raadi`): active-listing quota, price ceilings per category, image count, prohibited
  terms. The decision returns machine-readable reasons, which the API returns as `422` error codes and the web
  form translates. Policies have their own unit tests (`opa test`).
- `authz-init` creates the `raadi` store once and writes the model only when it differs from the latest one
  (models are immutable and versioned). Services resolve the store by name and use the latest model.
- Both clients in `service-kit` use short timeouts, retries and a **circuit breaker**. If either dependency is
  unavailable the request is refused with `503` (**fail closed**). Nothing falls back to "allow".
- OPA's own API requires a bearer token per client (`--authentication=token --authorization=basic`).
  Clients may only evaluate `data.raadi.*`, and policies cannot be changed over the API.

## Alternatives considered

- **Roles only (Keycloak)**: cannot express ownership ("only the seller may edit this listing").
- **Ownership checks in SQL per service**: they work for one service, but every service would reimplement
  sharing, moderation and delegation. OpenFGA keeps the model in one place for later phases (messaging,
  reviews).
- **OPA for everything**: Rego can express ownership only if every relationship is pushed to it as data.
  That is what OpenFGA is built for.

## Consequences

Each write that creates an owned object also writes a tuple. Tuple writes ignore duplicates, so retries are
safe. Purged images have their owner tuple removed. Deleted listings keep theirs, which is harmless because
every check also requires the listing to exist.
