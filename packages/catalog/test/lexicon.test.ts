import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_ATTRIBUTES,
  categoriesOf,
  COUNTRIES,
  COUNTRY_CODES,
  countryOfCategory,
} from '../src/taxonomy.js';
import { NODE_WORDS, VALUE_WORDS } from '../src/lexicon.js';

describe('lexicon', () => {
  it('names only categories and values that exist', () => {
    for (const id of Object.keys(NODE_WORDS))
      assert.ok(countryOfCategory(id), `unknown node ${id}`);
    for (const [key, values] of Object.entries(VALUE_WORDS)) {
      const def = ALL_ATTRIBUTES.get(key);
      assert.ok(def?.kind === 'select', `unknown select attribute ${key}`);
      for (const [value, entry] of Object.entries(values)) {
        assert.ok(def.options.includes(value), `${key}: unknown value ${value}`);
        if (entry.also)
          assert.ok(countryOfCategory(entry.also), `${key}.${value}: unknown ${entry.also}`);
      }
    }
  });

  it('has words for every category and subcategory in its country’s main language, in lower case', () => {
    for (const code of COUNTRY_CODES) {
      const main = COUNTRIES[code].locales[0]!;
      for (const root of categoriesOf(code))
        for (const node of [root, ...(root.children ?? [])]) {
          const words = NODE_WORDS[node.id]?.[main] ?? [];
          assert.ok(words.length > 0, `${code}: no ${main} words for ${node.id}`);
          for (const w of words) assert.equal(w, w.toLowerCase(), `${node.id}: "${w}"`);
        }
    }
  });
});
