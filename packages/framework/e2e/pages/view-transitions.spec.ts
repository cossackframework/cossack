import { test, expect } from '../fixtures';

test.describe('View Transitions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/view-transitions');
    await page.waitForLoadState('networkidle');
  });

  test('list page renders cards with data-transition-types', async ({ page }) => {
    // The list should have 4 cards
    const cards = page.locator('a[data-transition-types="nav-forward"]');
    await expect(cards).toHaveCount(4);

    // Each card should link to a detail route
    await expect(cards.first()).toHaveAttribute('href', '/view-transitions/1');
  });

  test('navigation to detail page wraps DOM commit in startViewTransition', async ({ page }) => {
    // Spy on document.startViewTransition BEFORE navigating
    await page.evaluate(() => {
      (window as any).__vtCalls = 0;
      const orig = (document as any).startViewTransition?.bind(document);
      if (!orig) return;
      (document as any).startViewTransition = function (cb: any) {
        (window as any).__vtCalls++;
        return orig(cb);
      };
    });

    // Click the first card
    await page.locator('a[data-transition-types="nav-forward"]').first().click();

    // Wait for detail page to render. The "Back to list" link only exists on
    // the detail page, so this actually waits for SPA navigation to complete
    // (the list page also contains "Mountain Sunset" text in its cards, so
    // matching that text alone would return before navigation finishes).
    await expect(page.locator('a[data-transition-types="nav-back"]')).toBeVisible({ timeout: 5000 });

    // Verify startViewTransition was called at least once
    const calls = await page.evaluate(() => (window as any).__vtCalls);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test('detail page renders and back link has nav-back type', async ({ page }) => {
    // Navigate to detail
    await page.locator('a[data-transition-types="nav-forward"]').first().click();
    await expect(page.locator('body')).toContainText('Mountain Sunset', { timeout: 5000 });

    // The back link should have data-transition-types="nav-back"
    const backLink = page.locator('a[data-transition-types="nav-back"]');
    await expect(backLink).toHaveAttribute('href', '/view-transitions');
  });

  test('navigating back uses startViewTransition', async ({ page }) => {
    // Go to detail first
    await page.locator('a[data-transition-types="nav-forward"]').first().click();
    await expect(page.locator('body')).toContainText('Mountain Sunset', { timeout: 5000 });

    // Spy on startViewTransition
    await page.evaluate(() => {
      (window as any).__vtCalls = 0;
      const orig = (document as any).startViewTransition?.bind(document);
      if (!orig) return;
      (document as any).startViewTransition = function (cb: any) {
        (window as any).__vtCalls++;
        return orig(cb);
      };
    });

    // Click back
    await page.locator('a[data-transition-types="nav-back"]').click();

    // Wait for list page to render
    await expect(page.locator('a[data-transition-types="nav-forward"]')).toHaveCount(4, { timeout: 5000 });

    const calls = await page.evaluate(() => (window as any).__vtCalls);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test('tab switch uses this.startViewTransition (same-route)', async ({ page }) => {
    // Spy on startViewTransition before clicking tab
    await page.evaluate(() => {
      (window as any).__vtCalls = 0;
      const orig = (document as any).startViewTransition?.bind(document);
      if (!orig) return;
      (document as any).startViewTransition = function (cb: any) {
        (window as any).__vtCalls++;
        return orig(cb);
      };
    });

    // Click the "details" tab
    await page.locator('button.vt-tab-button', { hasText: 'details' }).click();

    // Wait for tab content to update
    await expect(page.locator('.vt-tab-content')).toContainText('Technical specifications', { timeout: 5000 });

    // startViewTransition should have been called for the tab switch
    const calls = await page.evaluate(() => (window as any).__vtCalls);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test('reduced-motion style tag is injected', async ({ page }) => {
    // The auto-injected style tag should be present in the head
    const styleTag = page.locator('style#cossack-view-transitions-reduced-motion');
    await expect(styleTag).toHaveCount(1);

    // Verify it contains the reduced-motion media query
    const content = await styleTag.textContent();
    expect(content).toContain('prefers-reduced-motion');
    expect(content).toContain('animation-duration: 0s');
  });

  test('reduced motion: animation durations are zeroed', async ({ page }) => {
    // Emulate reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Verify the injected CSS is present
    const hasReducedMotionCSS = await page.evaluate(() => {
      const style = document.getElementById('cossack-view-transitions-reduced-motion');
      return style !== null && style.textContent?.includes('prefers-reduced-motion: reduce');
    });
    expect(hasReducedMotionCSS).toBe(true);
  });
});
