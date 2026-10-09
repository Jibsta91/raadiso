// Which country a host serves, and the languages its site offers (ADR-0040, ADR-0053).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countryForHost, countryLocales } from '../src/lib/country-host.ts';

describe('country-host', () => {
  it('finds the country of a host, its subdomains and the fallback', () => {
    const hosts = 'raadiso.com=XS, no.raadi.localhost=NO';
    assert.equal(countryForHost('raadiso.com', hosts, 'NO'), 'XS');
    assert.equal(countryForHost('admin.raadiso.com:443', hosts, 'NO'), 'XS');
    assert.equal(countryForHost('no.raadi.localhost', hosts, 'XS'), 'NO');
    assert.equal(countryForHost('raadi.localhost', hosts, 'NO'), 'NO');
    assert.equal(countryForHost('elsewhere.example', '', 'ZZ'), 'XS');
  });
  it('offers Somaliland English first, then Somali, and no Norwegian', () => {
    assert.deepEqual(countryLocales('XS'), { locales: ['en', 'so'], defaultLocale: 'en' });
  });
  it('keeps Norwegian first in Norway', () => {
    assert.deepEqual(countryLocales('NO'), { locales: ['nb', 'en', 'so'], defaultLocale: 'nb' });
  });
});
