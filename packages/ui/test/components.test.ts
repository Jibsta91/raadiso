// The building blocks render accessible markup and pass props (data-testid, ids, aria-*) through.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Alert,
  Avatar,
  Chip,
  EmptyState,
  Field,
  initials,
  Input,
  Kbd,
  Select,
  Skeleton,
  Tab,
  Tabs,
  Textarea,
} from '../src/index.ts';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('Input, Textarea, Select', () => {
  it('keep id, name, data-testid and other props, and use the field look', () => {
    const out = html(h(Input, { id: 'q', name: 'q', 'data-testid': 'q-input', type: 'search' }));
    assert.match(out, /^<input /);
    for (const attr of ['id="q"', 'name="q"', 'data-testid="q-input"', 'type="search"'])
      assert.ok(out.includes(attr), attr);
    assert.match(out, /class="[^"]*\bfield\b/);
    assert.match(html(h(Textarea, { name: 'body', rows: 4 })), /<textarea[^>]*rows="4"/);
    assert.match(
      html(h(Select, { name: 'sort' }, h('option', { value: 'a' }, 'A'))),
      /<select[^>]*name="sort"[^>]*><option value="a">A<\/option><\/select>/,
    );
  });

  it('let a caller class win over the defaults', () => {
    assert.match(html(h(Input, { className: 'h-9' })), /class="[^"]*\bh-9\b/);
    assert.doesNotMatch(html(h(Input, { className: 'h-9' })), /\bh-11\b/);
  });

  it('forward refs', () => {
    for (const c of [Input, Textarea, Select, Field, Alert, Skeleton, EmptyState, Chip, Kbd, Tab])
      assert.equal(
        (c as unknown as { $$typeof: symbol }).$$typeof,
        Symbol.for('react.forward_ref'),
      );
  });
});

describe('Field', () => {
  it('labels the control and describes it with the hint and the error', () => {
    const out = html(
      h(Field, { label: 'Title', hint: 'Short', error: 'Required' }, h(Input, { id: 'title' })),
    );
    assert.match(out, /<label for="title"/);
    assert.match(out, /<input[^>]*id="title"/);
    assert.match(out, /aria-describedby="title-hint title-error"/);
    assert.match(out, /aria-invalid="true"/);
    assert.match(out, /<p id="title-hint"[^>]*>Short<\/p>/);
    assert.match(out, /<p id="title-error"[^>]*>Required<\/p>/);
  });

  it('gives a control without an id one, and keeps an existing description', () => {
    const out = html(h(Field, { label: 'Name' }, h(Input, { 'aria-describedby': 'other' })));
    const id = /<label for="([^"]+)"/.exec(out)?.[1];
    assert.ok(id);
    assert.ok(out.includes(`id="${id}"`));
    assert.match(out, /aria-describedby="other"/);
    assert.doesNotMatch(out, /aria-invalid/);
  });

  it('passes data-testid to its wrapper', () => {
    assert.match(
      html(h(Field, { label: 'A', 'data-testid': 'f' }, h(Input, { id: 'a' }))),
      /^<div[^>]*data-testid="f"/,
    );
  });
});

describe('Alert', () => {
  it('announces problems at once and news politely', () => {
    assert.match(html(h(Alert, { variant: 'danger' }, 'Down')), /role="alert"/);
    assert.match(html(h(Alert, { variant: 'warning' }, 'Careful')), /role="alert"/);
    assert.match(html(h(Alert, { variant: 'success' }, 'Saved')), /role="status"/);
    assert.match(html(h(Alert, {}, 'Note')), /role="status"/);
  });

  it('takes an explicit role, a title and a test id', () => {
    const out = html(h(Alert, { role: 'none', title: 'Heads up', 'data-testid': 'x' }, 'Body'));
    assert.match(out, /role="none"/);
    assert.match(out, /data-testid="x"/);
    assert.match(out, /Heads up/);
  });
});

describe('Skeleton, EmptyState, Chip, Kbd', () => {
  it('hides skeletons from assistive technology and animates them only with motion allowed', () => {
    const out = html(h(Skeleton, { className: 'h-4' }));
    assert.match(out, /aria-hidden="true"/);
    assert.match(out, /motion-safe:animate-pulse/);
  });

  it('shows an empty state with a heading, text and an action', () => {
    const out = html(
      h(
        EmptyState,
        {
          title: 'Nothing yet',
          titleAs: 'h3',
          action: h('a', { href: '/new' }, 'Post'),
          'data-testid': 'e',
        },
        'Be the first',
      ),
    );
    assert.match(out, /data-testid="e"/);
    assert.match(out, /<h3[^>]*>Nothing yet<\/h3>/);
    assert.match(out, /Be the first/);
    assert.match(out, /<a href="\/new">Post<\/a>/);
  });

  it('makes a chip a toggle button, or styles a link', () => {
    assert.match(
      html(h(Chip, { selected: true }, 'New')),
      /<button type="button" aria-pressed="true"/,
    );
    assert.doesNotMatch(html(h(Chip, {}, 'Plain')), /aria-pressed/);
    const link = html(
      h(Chip, { asChild: true }, h('a', { href: '/x', 'aria-current': 'true' }, 'X')),
    );
    assert.match(link, /^<a [^>]*href="\/x"/);
    assert.match(link, /rounded-full/);
  });

  it('renders keys', () => {
    assert.equal(html(h(Kbd, {}, 'g')).replace(/ class="[^"]*"/, ''), '<kbd>g</kbd>');
  });
});

describe('Avatar and Tabs', () => {
  it('shows two initials, decorative', () => {
    assert.equal(initials('Amina Hassan'), 'AH');
    assert.equal(initials('ola.nordmann@raadi.localhost'), 'ON');
    assert.equal(initials(''), '?');
    assert.match(
      html(h(Avatar, { name: 'Amina Hassan', id: 'u1' })),
      /aria-hidden="true"[^>]*>AH</,
    );
  });

  it('marks the active tab as the current page', () => {
    const out = html(
      h(
        Tabs,
        { label: 'Sections' },
        h(Tab, { href: '/a', active: true, 'data-testid': 'tab-a' }, 'A'),
        h(Tab, { href: '/b' }, 'B'),
      ),
    );
    assert.match(out, /<nav aria-label="Sections"/);
    assert.match(out, /<a aria-current="page"[^>]*href="\/a"[^>]*data-testid="tab-a"/);
    assert.equal(out.match(/aria-current/g)?.length, 1);
  });
});
