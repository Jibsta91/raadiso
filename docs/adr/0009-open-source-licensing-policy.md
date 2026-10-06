# 0009 — Licensing policy: free, OSI first

- Status: Accepted (amended 2026-10-05)
- Date: 2026-10-01

## Context

The first version of this ADR allowed only OSI-approved licences. Phase 4 needs models that handle Norwegian and
Somali well, and several of the strongest free ones (Gemma, Llama, NLLB-200) are not OSI-licensed. Some useful
tools are source-available too. On 2026-10-05 the owner relaxed the rule: what matters is that every part is free
of charge and runs offline, and that whatever ships in production allows commercial use.

## Decision

- Every component (packages, container images, services, model weights and datasets) is free of charge and runs
  offline. No paid licences, paid SaaS or cloud API keys.
- Within that, each component falls into one class:

  | Class                                | Examples                                                                      | Allowed                                                          |
  | ------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
  | OSI-approved                         | MIT, Apache-2.0, BSD, MPL-2.0, GPL, AGPL                                      | Always                                                           |
  | Free, commercial use allowed         | BSL-1.1, SSPL, Elastic License 2.0, the Llama and Gemma community licences    | Always, including production, as long as Raadiso keeps the terms |
  | Free, non-commercial only            | CC-BY-NC (NLLB-200, Aya), research-only model licences                        | Development and Phase 4 only; replaced before Phase 5            |
  | Paid, or needs an online licence key | Commercial editions, enterprise directories of open-core projects, cloud APIs | Never                                                            |

- **OSI first.** When an OSI-licensed option is about as good, use it. The existing choices stay (Valkey,
  OpenBao, OpenTofu, SeaweedFS); nothing is switched back because of this amendment.
- **Keeping the terms.** Source-available licences forbid offering the component itself as a hosted or managed
  service; Raadiso is a marketplace and never does. Model licences come with acceptable-use policies and
  attribution, which Raadiso follows and shows where they ask for it.
- **Recorded, not silent.** Every non-OSI component is listed with its licence (SPDX id or name and URL), its class,
  its restrictions and whether it may stay in Phase 5: in the ADR that introduces it, in the allow-list of
  `tests/licenses/check-licenses.mjs` for packages, and in the models manifest for weights.
- **Swappable.** A non-commercial component must be replaceable by configuration: models sit behind a LiteLLM
  alias, and no contract, event or database schema depends on one model.
- **Phase 5 gate.** `compose.prod.yaml` and the production images contain no non-commercial component, and the
  list of non-OSI components is reviewed before launch.
- AGPL-3.0 components (Grafana, Loki, Tempo) run **unmodified as separate network services**. That is compliant,
  and their source is publicly available.
- `./raadi licenses` (CI gate) fails on npm dependencies that are neither OSI-licensed nor allow-listed. Data-only
  packages under CC licences (e.g. `caniuse-lite`) are allow-listed, and so is any non-OSI package admitted
  under this policy, with its class. Python dependencies and model weights get the same check in Phase 4.
- Open-core projects (e.g. Langfuse, LiteLLM) are used without their separately licensed enterprise directories,
  because those need a paid key. Each is noted in the ADR that introduces it.

## Consequences

- Phase 4 can pick the best free models for Norwegian and Somali, not only OSI-licensed ones.
- Raadiso can no longer be run, changed and redistributed by anyone without conditions: some components carry use
  restrictions, and the list of non-OSI components says which.
- Source-available licences can change between versions (Redis and Elasticsearch did). Versions are pinned, and a
  Renovate upgrade of a non-OSI component needs its licence checked again.
- Non-commercial components are temporary. Replacing them before Phase 5 needs a free commercial-use alternative,
  measured with the same evaluation sets.

## History

- 2026-10-01: accepted as OSI-only (no BSL, SSPL, source-available or paid SaaS dependencies).
- 2026-10-05: amended by the owner to the classes above.
