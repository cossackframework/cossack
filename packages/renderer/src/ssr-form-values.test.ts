import { describe, expect, it, vi } from 'vitest';
import { html, renderToString, hydrate, render } from './cossack-html';
import { parseFragment } from 'parse5';
import { bind, live } from './directives';

for (const spread of [false, true]) {
  for (const mode of ['plain', 'live', 'bind'] as const) {
    describe(`${spread ? 'spread' : 'direct'} ${mode} SSR form values`, () => {
      const property = (value: string) => mode === 'live' ? live(value) : mode === 'bind' ? bind({ value }, 'value') : value;
      const textarea = (value: string) => spread
        ? html`<textarea ...=${{ '.value': property(value), name: 'message' }}></textarea>`
        : html`<textarea .value=${property(value)} name="message"></textarea>`;
      const select = (value: string) => {
        const children = html`<optgroup label="Choices > more"><option selected value="a">A</option>
          ${['b&c', 'd'].map(v => html`<option value=${v}>${v}</option>`)}
        </optgroup>`;
        return spread ? html`<select ...=${{ '.value': property(value), name: 'choice' }}>${children}</select>`
          : html`<select .value=${property(value)} name="choice">${children}</select>`;
      };

      it('renders escaped textarea text and hydrates the same node', () => {
        const value = '<&" </textarea><script>alert(1)</script>';
        const template = textarea(value);
        const container = document.createElement('div');
        container.innerHTML = renderToString(template, { hydrate: true });
        const control = container.querySelector('textarea')!;
        expect(control.value).toBe(value);
        expect(control.hasAttribute('value')).toBe(false);
        expect(container.querySelector('script')).toBeNull();
        const warning = vi.spyOn(console, 'warn');
        try {
          hydrate(template, container);
          expect(container.querySelector('textarea')).toBe(control);
          expect(warning).not.toHaveBeenCalled();
          render(textarea('updated'), container);
          expect(control.value).toBe('updated');
        } finally { warning.mockRestore(); }
      });

      it('selects nested dynamic options before JS and retains them through hydration', async () => {
        const template = select('b&c');
        const container = document.createElement('div');
        container.innerHTML = renderToString(template, { hydrate: true });
        const control = container.querySelector('select')!;
        const options = [...control.options];
        expect(control.value).toBe('b&c');
        expect(control.hasAttribute('value')).toBe(false);
        expect(new FormData(Object.assign(document.createElement('form'), { innerHTML: container.innerHTML })).get('choice')).toBe('b&c');
        const warning = vi.spyOn(console, 'warn');
        try {
          hydrate(template, container);
          await Promise.resolve();
          expect(container.querySelector('select')).toBe(control);
          expect([...control.options]).toEqual(options);
          expect(warning).not.toHaveBeenCalled();
          render(select('d'), container);
          await Promise.resolve();
          expect(control.value).toBe('d');
        } finally { warning.mockRestore(); }
      });
    });
  }
}

it('uses decoded and whitespace-collapsed option text when value is absent', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(html`<select .value=${'B & C'}><option>A</option><option> B &amp;\n C </option></select>`);
  expect(container.querySelector('select')!.selectedIndex).toBe(1);
});

it('selects only the first duplicate match, including in multiple selects', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(html`<select multiple .value=${'b'}><option value="a" selected>A</option><option value="b">B</option><option value="b" selected>Other B</option></select>`);
  expect([...container.querySelectorAll('option')].map(o => o.selected)).toEqual([false, true, false]);
});

it('leaves literal value attributes and static selected options unchanged', () => {
  expect(renderToString(html`<textarea value="literal">Text</textarea><select><option selected>B</option></select>`))
    .toBe('<textarea value="literal">Text</textarea><select><option selected>B</option></select>');
});


it('preserves a leading LF through standards-based HTML parsing', () => {
  const output = renderToString(html`<textarea .value=${'\nfirst line'}></textarea>`);
  const parsed = parseFragment(output);
  const textarea = parsed.childNodes[0];
  expect('childNodes' in textarea && textarea.childNodes[0]).toMatchObject({ value: '\nfirst line' });
});


for (const value of [null, undefined, false, 0, '']) {
  it(`serializes ${String(value)} as a native text property`, () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(html`<textarea .value=${value}>old</textarea><textarea ...=${{'.value': live(value)}}>old</textarea>`);
    expect([...container.querySelectorAll('textarea')].map(el => el.value)).toEqual([String(value ?? ''), String(value ?? '')]);
  });
}


it('excludes script text when deriving option values', () => {
  const output = renderToString(html`<select .value=${'Choice'}><option>Other</option><option>Choice<script type="application/json">ignored</script></option></select>`);
  expect(output).toContain('<option selected>Choice<script');
});


it('selects option property values and overrides conflicting static defaults', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(html`<input value="old" .value=${'new'}><select .value=${'b'}><option>A</option><option value="old" .value=${'b'}>Other label</option></select>`);
  expect(container.querySelector('input')!.value).toBe('new');
  expect(container.querySelector('select')!.value).toBe('b');
});
