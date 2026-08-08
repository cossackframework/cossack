import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { html, renderToString, render } from './cossack-html';
import { repeat, classMap, styleMap, key, preventDefault, when, choose, map, join, range } from './directives';

describe('Directives', () => {
  it('repeat renders items', () => {
    const items = [
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ];
    const template = html`<ul>
      ${repeat(
        items,
        (i) => i.id,
        (i) => html`<li>${i.text}</li>`,
      )}
    </ul>`;
    expect(renderToString(template).trim()).toBe('<ul>\n      <li>A</li><li>B</li>\n    </ul>');
  });

  it('repeat preserves readonly array element types in both overloads', () => {
    interface OutreachRecord {
      id: number;
      dwelling: 'house' | 'apartment';
    }
    const dwellingLabels: Record<OutreachRecord['dwelling'], string> = {
      house: 'House',
      apartment: 'Apartment',
    };
    const records: readonly OutreachRecord[] = [
      { id: 1, dwelling: 'house' },
    ];

    repeat(
      records,
      (record) => {
        expectTypeOf(record).toEqualTypeOf<OutreachRecord>();
        return record.id;
      },
      (record) => dwellingLabels[record.dwelling],
    );
    repeat(records, (record) => {
      expectTypeOf(record).toEqualTypeOf<OutreachRecord>();
      return dwellingLabels[record.dwelling];
    });
  });

  it('classMap generates class string', () => {
    const classes = { foo: true, bar: false, baz: true };
    expect(classMap(classes)).toBe('foo baz');
  });

  it('styleMap generates style string', () => {
    const styles = { color: 'red', 'font-size': '12px', display: null };
    expect(styleMap(styles)).toBe('color:red;font-size:12px');
  });

  it('ref callback is called', () => {
    const container = document.createElement('div');
    const spy = vi.fn();

    const template = html`<div ref="${spy}"></div>`;
    render(template, container);

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement);
  });

  it('repeat handles keyed updates (simulated)', () => {
    const items = [{ id: 1, text: 'A' }];
    const template1 = html`${repeat(
      items,
      (i) => i.id,
      (i) => i.text,
    )}`;

    const container = document.createElement('div');
    render(template1, container);
    expect(container.textContent).toBe('A');

    const items2 = [
      { id: 2, text: 'B' },
      { id: 1, text: 'A-Upd' },
    ];
    const template2 = html`${repeat(
      items2,
      (i) => i.id,
      (i) => i.text,
    )}`;
    render(template2, container);
    expect(container.textContent).toBe('BA-Upd');
  });

  it('key is transparent in SSR', () => {
    const template = html`<div>${key('x', html`<b>hi</b>`)}</div>`;
    expect(renderToString(template).trim()).toBe('<div><b>hi</b></div>');
  });

  it('key rebuilds subtree when key changes', () => {
    const container = document.createElement('div');
    // Reuse the same `html` tagged template across renders so the engine
    // would normally take the in-place update path (cache hit). `key` must
    // force a rebuild when the key changes, producing a new DOM node.
    const tpl = (k: string) => html`<div>${key(k, html`<span class="marker">child</span>`)}</div>`;

    render(tpl('a'), container);
    const first = container.querySelector('.marker');
    expect(first).toBeInstanceOf(HTMLSpanElement);

    // Same key -> in-place update, same node identity preserved.
    render(tpl('a'), container);
    expect(container.querySelector('.marker')).toBe(first);

    // New key -> rebuild, new node identity.
    render(tpl('b'), container);
    const rebuilt = container.querySelector('.marker');
    expect(rebuilt).not.toBe(first);
    expect(container.textContent).toContain('child');
  });

  it('key handles undefined keys without infinite rebuild', () => {
    const container = document.createElement('div');
    const tpl = () => html`<div>${key(undefined, html`<span class="m">x</span>`)}</div>`;

    render(tpl(), container);
    const first = container.querySelector('.m');
    render(tpl(), container);
    // Same key (undefined) -> no rebuild, same node.
    expect(container.querySelector('.m')).toBe(first);
  });
});

describe('pure directives (when, choose, map, join, range)', () => {
  describe('when', () => {
    it('returns the true case when the condition is truthy', () => {
      expect(when(true, () => 'yes', () => 'no')).toBe('yes');
      // The truthy value is forwarded to the case function.
      expect(when('x', (c) => c)).toBe('x');
    });

    it('returns the false case when the condition is falsy', () => {
      expect(when(false, () => 'yes', () => 'no')).toBe('no');
    });

    it('returns undefined when falsy and no false case is given', () => {
      expect(when(0, () => 'yes')).toBeUndefined();
    });

    it('renders the chosen branch (SSR + client)', () => {
      const tpl = (on: boolean) =>
        html`<div>${when(on, () => html`<span class="on">On</span>`, () => html`<span class="off">Off</span>`)}</div>`;

      expect(renderToString(tpl(true)).trim()).toBe('<div><span class="on">On</span></div>');
      expect(renderToString(tpl(false)).trim()).toBe('<div><span class="off">Off</span></div>');

      const container = document.createElement('div');
      render(tpl(true), container);
      expect(container.querySelector('.on')).toBeInstanceOf(HTMLSpanElement);
      // Toggle to the other branch on the same template site.
      render(tpl(false), container);
      expect(container.querySelector('.on')).toBeNull();
      expect(container.querySelector('.off')).toBeInstanceOf(HTMLSpanElement);
    });
  });

  describe('choose', () => {
    it('selects the first matching case', () => {
      expect(
        choose('b', [
          ['a', () => 'A'],
          ['b', () => 'B'],
        ]),
      ).toBe('B');
    });

    it('uses the default case when nothing matches', () => {
      expect(
        choose('z', [
          ['a', () => 'A'],
          ['b', () => 'B'],
        ], () => 'D'),
      ).toBe('D');
    });

    it('returns undefined with no default', () => {
      expect(choose('z', [['a', () => 'A']])).toBeUndefined();
    });

    it('passes value and case index to the case function', () => {
      const spy = vi.fn(() => 'x');
      choose('b', [
        ['a', () => 'a'],
        ['b', spy],
      ]);
      expect(spy).toHaveBeenCalledWith('b', 1);
    });

    it('renders the chosen branch', () => {
      const tpl = (status: string) =>
        html`<div>${choose(status, [
          ['idle', () => html`<i class="idle">Idle</i>`],
          ['loading', () => html`<b class="loading">Loading</b>`],
        ], () => html`<span class="unknown">Unknown</span>`)}</div>`;

      expect(renderToString(tpl('loading')).trim()).toBe('<div><b class="loading">Loading</b></div>');
      expect(renderToString(tpl('nope')).trim()).toBe('<div><span class="unknown">Unknown</span></div>');

      const container = document.createElement('div');
      render(tpl('idle'), container);
      expect(container.querySelector('.idle')).toBeInstanceOf(HTMLElement);
    });
  });

  describe('map', () => {
    it('maps an array to values', () => {
      expect(map([1, 2, 3], (n) => n * 2)).toEqual([2, 4, 6]);
    });

    it('maps with the index', () => {
      expect(map(['a', 'b'], (_c, i) => i)).toEqual([0, 1]);
    });

    it('accepts a Set', () => {
      expect(map(new Set([1, 2]), (n) => n)).toEqual([1, 2]);
    });

    it('renders a list of templates', () => {
      const tpl = () => html`<ul>${map(['a', 'b'], (c) => html`<li>${c}</li>`)}</ul>`;
      expect(renderToString(tpl()).trim()).toBe('<ul><li>a</li><li>b</li></ul>');
    });
  });

  describe('join', () => {
    it('interleaves a static separator', () => {
      expect(join(['a', 'b', 'c'], (s) => s, ', ')).toEqual(['a', ', ', 'b', ', ', 'c']);
    });

    it('does not add a separator after the last item', () => {
      expect(join(['a'], (s) => s, ',')).toEqual(['a']);
      expect(join([], (s) => s, ',')).toEqual([]);
    });

    it('supports a separator function (receives the preceding item index)', () => {
      const spy = vi.fn((_index: number) => '|');
      join(['a', 'b'], (s) => s, spy);
      expect(spy.mock.calls[0][0]).toBe(0);
    });

    it('renders a separator template between items', () => {
      const tpl = () =>
        html`<ul>${join(['a', 'b'], (c) => html`<li>${c}</li>`, () => html`<li class="sep">•</li>`)}</ul>`;
      const out = renderToString(tpl()).trim();
      expect(out).toBe('<ul><li>a</li><li class="sep">•</li><li>b</li></ul>');
    });
  });

  describe('range', () => {
    it('range(end) yields [0, end)', () => {
      expect(range(3)).toEqual([0, 1, 2]);
      expect(range(0)).toEqual([]);
    });

    it('range(start, end) yields [start, end)', () => {
      expect(range(2, 5)).toEqual([2, 3, 4]);
    });

    it('range(start, end, step) honors a positive step', () => {
      expect(range(0, 10, 3)).toEqual([0, 3, 6, 9]);
    });

    it('walks downward with a negative step', () => {
      expect(range(5, 0, -1)).toEqual([5, 4, 3, 2, 1]);
    });

    it('returns [] for a zero step', () => {
      expect(range(0, 5, 0)).toEqual([]);
    });

    it('renders a range of items', () => {
      const tpl = () => html`<ul>${range(1, 4).map((n) => html`<li>${n}</li>`)}</ul>`;
      expect(renderToString(tpl()).trim()).toBe('<ul><li>1</li><li>2</li><li>3</li></ul>');
    });
  });
});

describe('preventDefault directive', () => {
  it('is transparent in SSR (event attr is stripped)', () => {
    const handler = vi.fn();
    const template = html`<form @submit="${preventDefault(handler)}"></form>`;
    // `@submit` is always stripped during SSR; the directive value must not be
    // serialized and must not throw.
    expect(renderToString(template).trim()).toBe('<form></form>');
  });

  it('prevents the default and invokes the wrapped handler', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handler = vi.fn();

    render(
      html`<form @submit="${preventDefault(handler)}"><button type="submit"></button></form>`,
      container,
    );
    const form = container.querySelector('form')!;
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    const dispatched = form.dispatchEvent(event);

    // preventDefault() was called, so dispatchEvent returns false.
    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    // Inner handler ran exactly once, with the event.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe(event);

    document.body.removeChild(container);
  });

  it('disables native validation by default (sets novalidate on the form)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handler = vi.fn();

    render(
      html`<form @submit="${preventDefault(handler)}"></form>`,
      container,
    );
    const form = container.querySelector('form')!;
    expect(form.hasAttribute('novalidate')).toBe(true);

    document.body.removeChild(container);
  });

  it('restores native validation with { novalidate: false }', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handler = vi.fn();

    render(
      html`<form @submit="${preventDefault(handler, { novalidate: false })}"></form>`,
      container,
    );
    const form = container.querySelector('form')!;
    // Native validation kept: no novalidate attribute, but default still
    // prevented (that part of the directive is unconditional).
    expect(form.hasAttribute('novalidate')).toBe(false);

    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(container);
  });

  it('removes novalidate on re-render when switching to { novalidate: false }', () => {
    // Regression: a form rendered with the default (novalidate: true) then
    // re-rendered with { novalidate: false } must end up WITHOUT the attribute,
    // so native validation is actually restored. The renderer rebuilds form
    // elements across re-renders, so we re-query the form each time and assert
    // the resulting DOM reflects the latest directive option. This pins both
    // the "set when true" and "remove when false" branches.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handler = vi.fn();
    const query = () => container.querySelector('form')!;

    // First render: default → novalidate set.
    render(html`<form @submit="${preventDefault(handler)}"></form>`, container);
    expect(query().hasAttribute('novalidate')).toBe(true);

    // Re-render with novalidate explicitly false → attribute absent.
    render(html`<form @submit="${preventDefault(handler, { novalidate: false })}"></form>`, container);
    expect(query().hasAttribute('novalidate')).toBe(false);

    // Switching back re-applies it (idempotent toggle both ways).
    render(html`<form @submit="${preventDefault(handler)}"></form>`, container);
    expect(query().hasAttribute('novalidate')).toBe(true);

    document.body.removeChild(container);
  });

  it('works on a child element (novalidate targets the ancestor form)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handler = vi.fn();

    render(
      html`<form>
        <button type="submit" @click="${preventDefault(handler)}">go</button>
      </form>`,
      container,
    );
    const form = container.querySelector('form')!;
    const button = container.querySelector('button')!;
    expect(form.hasAttribute('novalidate')).toBe(true);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(container);
  });

  it('unwraps correctly when used via a spread binding', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handler = vi.fn();

    render(
      html`<form ...=${{ '@submit': preventDefault(handler) }}></form>`,
      container,
    );
    const form = container.querySelector('form')!;
    expect(form.hasAttribute('novalidate')).toBe(true);

    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(container);
  });
});
