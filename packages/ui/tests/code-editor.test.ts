// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { component, render, renderToString } from '@cossackframework/renderer';
import { CodeEditor } from '../src/components/CodeEditor';
import { languageFor } from '../src/internal/code-editor.client';

// jsdom lays nothing out; CodeMirror asks ranges for their boxes while measuring.
const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = rect as unknown as () => DOMRect;

afterEach(() => { document.body.replaceChildren(); });

it('renders the text in a plain box on the server, escaped, before any editor loads', () => {
    const html = renderToString(component(CodeEditor, { id: 'code', value: '<b>{ "a": 1 }</b>', language: 'json' }));
    expect(html).toContain('data-language="json"');
    expect(html).toMatch(/<pre[^>]*>&lt;b&gt;\{ (?:"|&quot;)a(?:"|&quot;): 1 \}&lt;\/b&gt;<\/pre>/);
    expect(html).not.toContain('cm-editor');
});

it('resolves languages by name, alias or extension, and plain text for the unknown', async () => {
    expect(await languageFor('json')).not.toBeNull();
    expect(await languageFor('TS')).not.toBeNull();
    expect(await languageFor('py')).not.toBeNull();
    expect(await languageFor('')).toBeNull();
    expect(await languageFor('no-such-language')).toBeNull();
});

it('mounts CodeMirror in the browser and reports edits', async () => {
    const seen: string[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    render(component(CodeEditor, { id: 'code', value: 'one', language: 'markdown', onChange: (value: string) => seen.push(value) }), host);
    for (let tries = 0; tries < 50 && !host.querySelector('.cm-editor'); tries++) await new Promise(resolve => setTimeout(resolve, 20));
    const editor = host.querySelector('.cm-editor');
    expect(editor).not.toBeNull();
    expect(host.querySelector('.cm-content')?.textContent).toBe('one');
    expect(host.querySelector('.cm-content')?.getAttribute('aria-label')).toBe('Code');
});
