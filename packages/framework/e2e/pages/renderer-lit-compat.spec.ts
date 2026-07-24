import { expect, test } from '../fixtures';

test.describe('Renderer Lit compatibility demos', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/renderer/lit-compat');
    await expect(page.locator('[data-renderer-lit-demo]')).toBeVisible();
    // The demo markup is present from SSR before client hydration finishes.
    // Wait for Cossack's readiness signal, then yield two animation frames so
    // the async mount/update and nested component hydration microtasks settle
    // before any test captures DOM node identity.
    await page.waitForFunction(
      () => (window as any).__cossackReady === true,
      undefined,
      { timeout: 15000 },
    );
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

    const cardStyleIds = await page.locator('style[data-cossack-style]').evaluateAll((styles) =>
      styles
        .map((style) => style.getAttribute('data-cossack-style'))
        .filter((id): id is string => id !== null),
    );
    expect(cardStyleIds.length).toBeGreaterThanOrEqual(5);
    expect(cardStyleIds.some((id, index) => cardStyleIds.indexOf(id) !== index)).toBe(true);
  });
});
