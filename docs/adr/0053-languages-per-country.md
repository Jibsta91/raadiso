# 0053 — Each country's site offers its own languages: raadiso.com is English, then Somali

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0032](0032-multi-country-marketplace.md) (country and language are separate) and
  [ADR-0040](0040-countries-money-and-taxonomy-as-data.md) (countries as data, a country per host).

## Context

The catalogue already gave every country its languages, default first (Somaliland `['en', 'so']`,
Norway `['nb', 'en', 'so']`), and Somaliland prices in USD. The website ignored it: its routing
offered Norwegian, English and Somali on every host, with Norwegian as the default, so raadiso.com
sent a visitor without a language preference to `/nb`. The owner asked for Norwegian to go, English
first and Somali second, in USD.

## Decision

- **The website follows the host's country.** The proxy finds the country from the host
  (`COUNTRY_HOSTS`, `DEFAULT_COUNTRY`) and negotiates the language (Accept-Language, then the cookie)
  among that country's languages only, falling back to its first. A path in a language the country
  doesn't offer (`/nb/…` on raadiso.com) redirects (307, not cached for good) to the same page in the
  default. The language switcher, the hreflang links and the sitemap list only the country's
  languages.
- **The app does the same** with its build's country (`EXPO_PUBLIC_COUNTRY`): the device's language
  is picked among the country's languages, and the account screen offers only those.
- **Nothing is deleted.** The Norwegian catalogues stay, because Norway is the second test country and
  the development stack runs as Norway; adding a language to a country is one line in
  `packages/catalog/src/countries.ts`.
- Currency is unchanged: Somaliland's listings are priced in US dollars (ADR-0040).

## Consequences

- raadiso.com answers in English unless the browser prefers Somali; Norwegian links redirect.
- Keycloak's pages already default to English and follow the language the site passes on.
- The development stack (Norway) behaves as before, so the e2e suite is unchanged.
