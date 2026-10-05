# Runbooks

Step-by-step procedures for alerts and routine operations. Alert rules link here through `runbook_url`.
Commands assume the repository root (development) or `DEPLOY_DIR` (production, `/home/prod/raadi`).

| Runbook                                  | Use when                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [service-down.md](service-down.md)       | `ScrapeTargetDown`, `ServiceStoppedReportingTelemetry`, a container is unhealthy                                          |
| [high-error-rate.md](high-error-rate.md) | `GatewayHighErrorRate`, `GatewayHighLatency`                                                                              |
| [auth-anomalies.md](auth-anomalies.md)   | `AuthLoginFailuresSpike`, suspected credential stuffing                                                                   |
| [openbao.md](openbao.md)                 | `OpenBaoSealed`, secret retrieval or rotation                                                                             |
| [event-pipeline.md](event-pipeline.md)   | `DeadLettersGrowing`, `ConsumerLagHigh`, `ConsumerGroupEmpty`, `SearchIndexLagHigh`, `EmailQueueBacklog`, `EmailsGivenUp` |
| [trust.md](trust.md)                     | BankID verification failing, "taken" identities, review moderation, review eligibility questions                          |
| [payments.md](payments.md)               | `PaymentsStuckOpen`, `PaymentWebhooksRejected`, refunds, test payments                                                    |
| [notifications.md](notifications.md)     | `PushQueueBacklog`, `PushesGivenUp`, a user gets no pushes                                                                |
| [moderation.md](moderation.md)           | `ModerationQueueStale`, `ReportsSpike`, blocks, removing reviews                                                          |
| [saved.md](saved.md)                     | `SavedSearchChecksFailing`, favourites not following price changes                                                        |
| [messaging.md](messaging.md)             | `WebSocketOriginRejected`, messages arriving only after a reload, closed conversations                                    |
| [audit.md](audit.md)                     | A staff action missing from the audit log, "who did this?"                                                                |
| [slo.md](slo.md)                         | `SLOFastBurn`, `SLOSlowBurn`, `SLOBudgetExhausted`, `JourneyProbeFailing`; the status page shows a journey down           |
