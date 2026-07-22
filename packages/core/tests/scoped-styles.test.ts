import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { isTemplateResult, renderToString } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';
import { css, html } from '../src/index';

describe('Cossack component output finalization', () => {
  it('applies renderer scoped styles to the page/layout composition path', () => {
    class PageComponent extends Cossack {
      static styles = css`.page { color: red; }`;
      render() { return html`<main class="page">page</main>`; }
    }
    class LayoutComponent extends Cossack {
      static styles = css`.layout { display: block; }`;
      render() { return html`<section class="layout">${this.children}</section>`; }
    }

    const page = new PageComponent();
    const layout = new LayoutComponent();
    layout.children = page._getWrappedTemplate();
    const output = renderToString(layout._getWrappedTemplate()!);

    const styleIds = [...output.matchAll(/data-cossack-style="([^"]+)"/g)].map((match) => match[1]);
    expect(styleIds).toHaveLength(2);
    expect(styleIds[0]).not.toBe(styleIds[1]);
    expect(output).toContain(`<section data-cossack-scope="${styleIds[0]}" class="layout">`);
    expect(output).toContain(`<main data-cossack-scope="${styleIds[1]}" class="page">page</main>`);
  });

  it('normalizes a non-template loadingTemplate result before finalization', () => {
    class LoadingComponent extends Cossack {
      loadingTemplate(): any { return 'Loading safely'; }
      render() { return html`<main>ready</main>`; }
    }

    const component = new LoadingComponent();
    component.loading.init = 1;
    const output = component._getWrappedTemplate();

    expect(isTemplateResult(output)).toBe(true);
    expect(renderToString(output!)).toBe('Loading safely');
  });
});
