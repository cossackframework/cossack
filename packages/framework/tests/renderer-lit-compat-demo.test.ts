import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { collectComponentStyles, renderToString } from '@cossackframework/renderer/server';
import LitCompatibilityDemo from '../src/pages/renderer/lit-compat';

describe('renderer Lit compatibility demo', () => {
  it('renders all three demos through the framework component path', () => {
    const page = new LitCompatibilityDemo();
    const { result: output, styles } = collectComponentStyles(() => renderToString(page._getWrappedTemplate()!));

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

    // Two StyledCard instances share one stylesheet; no style sits in the markup.
    const styleIds = styles.map((style) => style.scopeId);
    expect(styleIds.length).toBeGreaterThanOrEqual(4);
    expect(new Set(styleIds).size).toBe(styleIds.length);
    expect(output).not.toContain('<style');
    for (const scopeId of styleIds) expect(output).toContain(`data-cossack-scope="${scopeId}"`);
    expect(styles.map((style) => style.cssText).join('\n')).toMatch(/@keyframes c[a-z0-9]+-scoped-arrival/);
  });
});
