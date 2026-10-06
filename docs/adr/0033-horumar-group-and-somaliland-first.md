# 0033 — Horumar Group owns Raadiso; Somaliland is the first market

- Status: Accepted
- Date: 2026-10-05

## Context

[ADR-0032](0032-multi-country-marketplace.md) made Raadi a marketplace for many countries and left the brand
and domain (its decision 1) and the launch order (its decision 8) open. It named Norway as the first country,
because Phases 1–3 were built for Norway. The owner has since decided both.

## Decision

- **Horumar Group** (horumargroup.com) is the company that owns Raadiso; the owner plans more products under
  it. _Horumar_ is Somali for "progress".
- **The brand stays Raadiso** (raadiso.com) for the first market. Whether later countries get their own brands
  is decided at each launch (ADR-0032, decision 1). The code keeps the working name `raadi`.
- **Somaliland is the first market.** Norway stays the configuration that the code and the demo data use until
  Somaliland's configuration exists; nothing Norwegian is removed.

## What Somaliland's configuration needs

Each item is settled in the follow-up ADRs that ADR-0032 lists.

- **Country code:** Somaliland has no ISO 3166-1 code. Use a code from the user-assigned range (as Kosovo uses
  `XK`); never file Somaliland under Somalia (`SO`).
- **Money:** most prices are in US dollars. The Somaliland shilling has no ISO 4217 code.
- **Payments:** mobile money (ZAAD from Telesom, eDahab from Somtel) through the payment adapters of
  [ADR-0020](0020-payments.md). Card providers such as Stripe do not serve Somaliland.
- **Identity checks:** there is no BankID. Start with verifying the phone number.
- **Languages:** Somali (already supported) and English. Arabic needs right-to-left support.
- **Places:** Somaliland's regions and towns. Some areas are disputed, so place data and maps need care.
- **Addresses:** few postcodes. Use the district, a landmark and a map pin (for example Plus Codes, which are
  Apache-2.0 and work offline).
- **Phones:** +252 numbers.
- **Categories:** local ones such as livestock, land plots and rentals. Prohibited items follow local law
  (OPA).
- **Devices:** mostly Android phones on slow and costly mobile data, so pages and images stay light.

## Alternatives considered

- **Norway first** (ADR-0032): the code is ready for it, but the owner chose Somaliland, where the owner plans
  more products and where _raadi_ ("search" in Somali) speaks to the customers.
- **A new international brand now:** postponed to later countries. Raadiso is already owned and fits Somali
  speakers.

## Consequences

- Once the company is registered, the terms and the privacy policy name it as the operator. The
  legal-advisor drafts them and a lawyer approves them.
- Company e-mail uses horumargroup.com; product e-mail (support) stays on raadiso.com.
- The project-manager plans Somaliland's configuration as slices, starting with the country code and the
  data model (ADR-0032 decisions 2 and 3) and then money and payments (decision 4).
- People in the diaspora who use Raadiso from Europe keep GDPR in scope.
