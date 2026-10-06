// Search-engine helpers: language alternates, descriptions and safe JSON-LD.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jsonLd, localeAlternates, summary } from '../src/lib/seo.ts';

describe('seo', () => {
  it('lists the page in every language, with the default for others', () => {
    const a = localeAlternates({ locales: ['nb', 'en', 'so'], defaultLocale: 'nb' }, 'en', '/bil');
    assert.equal(a?.canonical, '/en/bil');
    assert.deepEqual(a?.languages, {
      nb: '/nb/bil',
      en: '/en/bil',
      so: '/so/bil',
      'x-default': '/nb/bil',
    });
  });
  it('shortens descriptions at a word, without trailing punctuation', () => {
    assert.equal(summary('Kort.'), 'Kort.');
    const long = `${'ord '.repeat(60)}slutt`;
    const s = summary(long, 40);
    assert.ok(s.length <= 40 && s.endsWith('…') && !s.includes(' …'));
    assert.equal(summary('a\n\n b'), 'a b');
  });
  it('cannot end the script element it is embedded in', () => {
    assert.ok(!jsonLd({ name: '</script><script>alert(1)</script>' }).includes('</'));
  });
});
