import { expect, test, type Page } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

const headStyleIds = (page: Page) => page.locator('head style[data-cossack-style]').evaluateAll((styles) =>
  styles.map((style) => style.getAttribute('data-cossack-style')!));

async function sidebarLink(page: Page, href: string) {
  const link = page.getByTestId('desktop-sidebar').locator(`a[href="${href}"]`);
  const group = link.locator('xpath=ancestor::details[1]');
  if (await group.count() && await group.getAttribute('open') === null) {
    await group.locator(':scope > summary').click();
  }
  await expect(link).toBeVisible();
  return link;
}

test.describe('Renderer Lit compatibility demos', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/renderer/lit-compat');
    await expect(page.locator('[data-renderer-lit-demo]')).toBeVisible();
    // The demo markup is present from SSR before client hydration finishes.
    // Wait for Cossack's readiness signal, then yield two animation frames so
    // the async mount/update and nested component hydration microtasks settle
    // before any test captures DOM node identity.
    await waitForHydration(page);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
  });

  test('renders and updates namespaced SVG fragments in place', async ({ page }) => {
    const circle = page.locator('#svg-demo-stage circle').first();
    const foreignHtml = page.locator('[data-foreign-object-html]');

    await expect(page.locator('#svg-color-toggle')).toHaveClass(/cs-button/);
    await expect(page.locator('#svg-size-toggle')).toHaveClass(/cs-button/);
    await expect(circle).toHaveAttribute('fill', '#7c3aed');
    expect(await circle.evaluate((element) => element.namespaceURI)).toBe('http://www.w3.org/2000/svg');
    expect(await foreignHtml.evaluate((element) => element.namespaceURI)).toBe('http://www.w3.org/1999/xhtml');
    await circle.evaluate((element) => ((window as any).__cossackDemoCircle = element));

    await page.locator('#svg-color-toggle').click();
    await expect(circle).toHaveAttribute('fill', '#db2777');
    expect(await circle.evaluate((element) => element === (window as any).__cossackDemoCircle)).toBe(true);

    await page.locator('#svg-size-toggle').click();
    await expect(page.locator('#svg-demo-stage')).toHaveAttribute('viewBox', '0 0 620 280');
  });

  test('demonstrates nothing in every binding context', async ({ page }) => {
    const child = page.locator('#nothing-child');
    const attribute = page.locator('#nothing-attribute');
    const property = page.locator('#nothing-property');
    const booleanButton = page.locator('#nothing-boolean');
    const eventButton = page.locator('#nothing-event');
    const spread = page.locator('#nothing-spread');

    await expect(page.locator('#nothing-toggle')).toHaveClass(/cs-button/);
    await expect(page.locator('#event-toggle')).toHaveClass(/cs-button/);
    await expect(booleanButton).not.toHaveClass(/cs-button/);
    await expect(eventButton).not.toHaveClass(/cs-button/);
    await expect(child).toHaveText('managed child content');
    await expect(attribute).toHaveAttribute('data-demo-state', 'value-present-suffix');
    await expect(property).toBeChecked();
    await expect(booleanButton).toBeDisabled();
    await expect(spread).toHaveAttribute('data-spread-state', 'present');

    await eventButton.click();
    await expect(page.locator('#event-count')).toHaveText('1');
    await page.locator('#event-toggle').click();
    await eventButton.click();
    await expect(page.locator('#event-count')).toHaveText('1');

    await page.locator('#nothing-toggle').click();
    await expect(child).toBeEmpty();
    await expect(attribute).not.toHaveAttribute('data-demo-state', /.+/);
    await expect(property).not.toBeChecked();
    await expect(booleanButton).toBeEnabled();
    await expect(spread).not.toHaveAttribute('data-spread-state', /.+/);
    await expect(spread).not.toHaveAttribute('title', /.+/);
  });

  test('isolates component styles and retains projected template ownership', async ({ page }) => {
    const pageRoot = page.locator('[data-renderer-lit-demo]');
    const pageSibling = page.locator('[data-page-scope-sibling]');
    const childSibling = page.locator('[data-demo-sibling]');
    const projected = page.locator('[data-projected-copy]');
    const projectionHost = page.locator('[data-projection-host]');

    const pageScope = await pageRoot.getAttribute('data-cossack-scope');
    const childScope = await childSibling.getAttribute('data-cossack-scope');
    expect(pageScope).toBeTruthy();
    expect(childScope).toBeTruthy();
    expect(childScope).not.toBe(pageScope);
    await expect(pageSibling).toHaveAttribute('data-cossack-scope', pageScope!);
    await expect(projected).toHaveAttribute('data-cossack-scope', pageScope!);
    await expect(projectionHost).not.toHaveAttribute('data-cossack-scope', pageScope!);

    await expect(pageSibling).toHaveCSS('color', 'rgb(29, 78, 216)');
    await expect(childSibling).toHaveCSS('color', 'rgb(185, 28, 28)');
    await expect(projected).toHaveCSS('color', 'rgb(37, 99, 235)');

    // Two StyledCard instances share one head stylesheet; none sits in the body.
    const styleIds = await headStyleIds(page);
    expect(styleIds.length).toBeGreaterThanOrEqual(4);
    expect(new Set(styleIds).size).toBe(styleIds.length);
    expect(styleIds).toEqual(expect.arrayContaining([pageScope, childScope]));
    await expect(page.locator('body style[data-cossack-style]')).toHaveCount(0);
    await expect(page.locator('[data-demo-card]')).toHaveCount(2);
  });

  test('adopts the server head styles and swaps them on client navigation', async ({ page }) => {
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents.push(request.url());
    });
    const ssrIds = await headStyleIds(page);
    expect(ssrIds.length).toBeGreaterThanOrEqual(4);
    // Hydration adopted the server-rendered elements instead of adding copies.
    await page.evaluate(() => {
      for (const style of document.head.querySelectorAll('style[data-cossack-style]')) (style as any).__fromServer = true;
    });
    await page.locator('#svg-color-toggle').click();
    expect(await headStyleIds(page)).toEqual(ssrIds);
    expect(await page.evaluate(() => [...document.head.querySelectorAll('style[data-cossack-style]')]
      .every((style) => (style as any).__fromServer === true))).toBe(true);

    // The directives page has no styled components: the last teardown removes them.
    await (await sidebarLink(page, '/renderer/directives')).click();
    await expect(page).toHaveURL(/\/renderer\/directives$/);
    await expect(page.locator('head style[data-cossack-style]')).toHaveCount(0);

    // Navigating back inserts each scope once again, without a document load.
    await (await sidebarLink(page, '/renderer/lit-compat')).click();
    await expect(page).toHaveURL(/\/renderer\/lit-compat$/);
    await expect(page.locator('[data-demo-card]')).toHaveCount(2);
    await expect.poll(async () => (await headStyleIds(page)).sort()).toEqual([...ssrIds].sort());
    await expect(page.locator('body style[data-cossack-style]')).toHaveCount(0);
    await expect(page.locator('[data-demo-sibling]')).toHaveCSS('color', 'rgb(185, 28, 28)');
    expect(documents).toHaveLength(0);
  });
});
