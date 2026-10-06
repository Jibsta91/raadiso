# 0032 — One marketplace for many countries

- Status: Accepted. The first country and its brand are decided in
  [ADR-0033](0033-horumar-group-and-somaliland-first.md): Somaliland first, with Raadiso.
- Date: 2026-10-05

## Context

Raadi was scoped as a classifieds marketplace for Norway in the spirit of Finn.no, and Phases 1–3 were built
that way. The owner has changed the goal: one marketplace for many countries, like Locanto, which runs free
classifieds in more than 60 countries under one brand, with a site per country.

Norway is built into the product today:

- Places are Norwegian towns grouped by county (`packages/catalog/src/places.ts`), and a listing's location
  stores a `county`.
- Payments and promoted listings assume NOK and Vipps ([ADR-0020](0020-payments.md)); identity verification is
  BankID ([ADR-0018](0018-reviews-and-trust.md)); orders are kept for the Norwegian bookkeeping period.
- The website and the app speak `nb`, `en` and `so`.
- The threat model and the GDPR plan cover Norway and the EU only; the brand and domain are Raadiso and
  raadiso.com ([ADR-0023](0023-domain-dns-and-tls.md)).

## Decision

- **Raadi becomes a marketplace for many countries, with one codebase and one brand.** Norway is the first
  country and the reference configuration; nothing that works there is removed.
- **Country is a first-class dimension, separate from language.** A country (ISO 3166-1 alpha-2 code) decides
  the currency, places, categories, legal texts, payment and identity providers and the scope of search. A
  locale (BCP 47 tag) decides the language and the formats. A listing belongs to one country and is priced in
  that country's currency. A Somali speaker in Norway sees Somali text and prices in kroner.
- **Countries are added by configuration and adapters, not forks.** Country data (currency, locales, places,
  categories, prohibited items, legal texts) is configuration. Payments and identity checks are adapters
  behind the interfaces that exist today.
- **No new code assumes one country.** No hard-coded country, currency, locale, time zone, phone or address
  format. Reviews check it.

## Follow-up decisions

Each gets its own ADR before the work that depends on it.

| #   | Decision                                                                                                                                              | Owner agent                      | Needed before                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| 1   | Brand and domain for an international product: keep Raadiso or choose a new name, and which country domains to register                               | project-manager, with the owner  | Phase 5 (production domain, e-mail sender, store listings) |
| 2   | Country URLs: subdomains, path prefixes or country domains; how they combine with the locale prefix, sessions and cookies across hosts, and SEO       | architect                        | The first country after Norway                             |
| 3   | Data model: country on listings and accounts, places and categories per country, one search index with a country field or one index per country       | architect, backend-engineer      | The first country after Norway                             |
| 4   | Money: currency per listing and order, payment providers per country, VAT on paid features                                                            | backend-engineer                 | The first paid feature outside Norway                      |
| 5   | Identity checks per country (BankID covers Norway only)                                                                                               | security-engineer                | Trust features outside Norway                              |
| 6   | Law and privacy per country: GDPR as the baseline, the EU Digital Services Act for marketplaces, each country's privacy, consumer and residency rules | legal-advisor, security-engineer | Each launch                                                |
| 7   | Languages: the next locales, right-to-left support, the translation workflow, search analyzers and AI evaluation sets per language                    | i18n-engineer                    | Each launch                                                |
| 8   | Launch order and a launch checklist per country                                                                                                       | project-manager, i18n-engineer   | Each launch                                                |

The owner agents are the Claude Code subagents described in [docs/ai-team.md](../ai-team.md).

## Alternatives considered

- **Stay a marketplace for Norway** (the original scope): the owner decided against it.
- **One codebase and deployment per country** (a fork per market): every feature would be built several
  times, and several stacks do not fit the laptop budget ([ADR-0011](0011-resource-budget.md)). Separate
  deployments per region can still come later if residency rules require them (decision 6).
- **Add countries after the launch:** cheaper today, but adding a country to live data means migrating real
  people's listings and orders.

## Consequences

- The roadmap gets a "Many countries" section, and the project-manager places the follow-up decisions into
  the phases. Decisions 2 and 3 should land before the public launch in Phase 5.
- Existing ADRs stay valid as Norway's configuration. Follow-up ADRs supersede the parts that change (at
  least ADR-0018, ADR-0020, ADR-0023 and ADR-0024).
- Tests cover at least two countries and two locales where behaviour differs. The AI pillars (Phase 4) need an
  evaluation set for each launch language.
- Reviews reject hard-coded country, currency, locale or time-zone assumptions.
