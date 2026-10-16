import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer/server';
import ComponentTagsDemo from '../src/pages/renderer/component-tags';

/** The opening tag of the element with this id. */
const openingTag = (output: string, id: string) => output.match(new RegExp(`<[a-z]+[^>]* id="${id}"[^>]*>`))?.[0] ?? '';

describe('renderer component tags demo', () => {
  const output = renderToString(new ComponentTagsDemo()._getWrappedTemplate()!);

  it('passes static, interpolated, bare, bound and spread attributes as props', () => {
    expect(output).toContain('data-component-tags-demo');
    expect(openingTag(output, 'tile-static')).toContain('data-tone="plain"');
    expect(output).toMatch(/id="tile-static"[^>]*>\s*<strong data-heading>Static text &amp; entities<\/strong>/);

    const live = openingTag(output, 'tile-live');
    expect(live).toContain('data-tone="accent"');
    expect(live).toContain('data-pinned');
    expect(output).toMatch(/id="tile-live"[^>]*>\s*<strong data-heading>Clicked 0 times<\/strong>/);

    // Later attributes override the spread; the spread's other props remain.
    expect(openingTag(output, 'tile-spread')).toContain('data-tone="accent"');
    expect(output).toMatch(/id="tile-spread"[^>]*>\s*<strong data-heading>Spread, then override<\/strong>[\s\S]*?<span data-count>7<\/span>/);
  });

  it('passes each kind of content as children and named slots as props', () => {
    expect(openingTag(output, 'frame-none')).toContain('data-children-kind="none"');
    expect(openingTag(output, 'frame-text')).toContain('data-children-kind="string"');
    expect(openingTag(output, 'frame-value')).toContain('data-children-kind="number"');
    expect(openingTag(output, 'frame-template')).toContain('data-children-kind="template"');
    expect(openingTag(output, 'frame-nested')).toContain('data-children-kind="template"');
    expect(output).toMatch(/<footer[^>]*data-frame-footer[^>]*><small>Named slot through a prop<\/small>/);
    expect(output).toMatch(/id="frame-nested"[\s\S]*?cs-badge[\s\S]*?inside[\s\S]*?cs-badge[\s\S]*?a frame/);
  });

  it('renders stateful children and a class chosen at runtime', () => {
    expect(output).toContain('data-step-counter="By one"');
    expect(output).toContain('data-step-counter="By five"');
    expect(output).toMatch(/data-step-counter="By five"[\s\S]*?\+5/);
    expect(output).toContain('id="reported-count">0<');
    expect(output).toContain('data-note="info"');
    expect(output).not.toContain('data-note="warning"');
  });
});
