import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import LitCompatibilityDemo from '../src/pages/renderer/lit-compat';

describe('renderer Lit compatibility demo', () => {
  it('renders all three demos through the framework component path', () => {
    const page = new LitCompatibilityDemo();
    const output = renderToString(page._getWrappedTemplate()!);

    expect(output).toContain('data-renderer-lit-demo');
    expect(output).toContain('id="svg-template-demo"');
    expect(output).toContain('data-svg-fragment');
    expect(output).toContain('data-foreign-object-html');
    expect(output).toContain('id="nothing-sentinel-demo"');
    expect(output).toContain('data-demo-state="value-present-suffix"');
    expect(output).toContain('id="scoped-styles-demo"');
    expect(output).toContain('data-demo-card="First instance"');
    expect(output).toContain('data-demo-card="Second instance"');
    expect(output).toContain('data-projected-copy');

    const styleIds = [...output.matchAll(/data-cossack-style="([^"]+)"/g)].map((match) => match[1]);
    expect(styleIds.length).toBeGreaterThanOrEqual(5);
    expect(new Set(styleIds).size).toBeGreaterThanOrEqual(4);
    expect(output).toMatch(/@keyframes c[a-z0-9]+-scoped-arrival/);
  });
});
