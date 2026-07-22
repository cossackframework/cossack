import { test, expect } from '../fixtures';

test.describe('DI Demo Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/di-demo');
  });

  test('should render the page with injected service', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent();
    expect(body).toContain('Dependency Injection Demo');
    expect(body).toContain('Count: 0');
    const state = await page.evaluate(() => {
      const layout = (window as any).__INITIAL_STATE__._layout_stack
        .find((item: any) => item.path.endsWith('/di-demo/layout.ts'));
      return layout.state;
    });
    expect(state.public).not.toHaveProperty('count');
    expect(state.services).toEqual({ '0': { count: 0 } });
  });

  test('should increment counter via service', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Verify initial state
    const body = await page.locator('body').textContent();
    expect(body).toContain('Count: 0');

    // Click increment
    await page.click('button:has-text("+")');

    // Wait for the count to update to 1
    await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/);
      return match ? parseInt(match[1], 10) === 1 : false;
    });

    const afterIncrement = await page.locator('body').textContent();
    expect(afterIncrement).toContain('Count: 1');
    await expect(page.getByTestId('layout-service-count')).toHaveText('Count: 1');
  });

  test('should decrement counter via service', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // First increment to 1
    await page.click('button:has-text("+")');
    await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/);
      return match ? parseInt(match[1], 10) === 1 : false;
    });

    // Now decrement back to 0
    await page.click('button:has-text("-")');
    await page.waitForFunction(() => {
      const text = document.body.textContent || '';
      const match = text.match(/Count:\s*(\d+)/);
      return match ? parseInt(match[1], 10) === 0 : false;
    });

    const afterDecrement = await page.locator('body').textContent();
    expect(afterDecrement).toContain('Count: 0');
  });

  test('should handle multiple increments', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click increment 3 times
    for (let i = 0; i < 3; i++) {
      await page.click('button:has-text("+")');
      await page.waitForFunction((expected) => {
        const text = document.body.textContent || '';
        const match = text.match(/Count:\s*(\d+)/);
        return match ? parseInt(match[1], 10) === expected : false;
      }, i + 1);
    }

    const body = await page.locator('body').textContent();
    expect(body).toContain('Count: 3');
  });

  test('persists within the layout and resets after leaving its subtree', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("+")');
    await expect(page.locator('body')).toContainText('Count: 1');

    await page.click('a:has-text("Open another page")');
    await expect(page).toHaveURL(/\/di-demo\/other$/);
    await expect(page.getByTestId('page-service-count')).toHaveText('Count: 1');
    await expect(page.getByTestId('nested-service-count')).toHaveText('Count: 1');

    await page.click('a:has-text("Leave DI layout")');
    await expect(page).toHaveURL(/\/$/);

    // A history traversal updates the URL before Cossack finishes its async
    // SPA render. Wait for the matching route-ready event so the assertions
    // below observe the newly committed page rather than the outgoing page.
    await page.evaluate(() => {
      (window as any).__cossackE2EReadyPath = undefined;
      const handleReady = (event: Event) => {
        const pathname = (event as CustomEvent).detail?.pathname;
        if (pathname !== '/di-demo/other') return;
        (window as any).__cossackE2EReadyPath = pathname;
        document.removeEventListener('cossack:ready', handleReady);
      };
      document.addEventListener('cossack:ready', handleReady);
    });
    await page.goBack();
    await page.waitForFunction(
      () => (window as any).__cossackE2EReadyPath === '/di-demo/other',
    );
    await expect(page).toHaveURL(/\/di-demo\/other$/);
    await expect(page.getByTestId('page-service-count')).toHaveText('Count: 0');
    await expect(page.getByTestId('nested-service-count')).toHaveText('Count: 0');
  });

  test('supports service redirects and rejects forged service actions', async ({ page, request }) => {
    const target = await page.evaluate(() => {
      const layout = (window as any).__INITIAL_STATE__._layout_stack
        .find((item: any) => item.path.endsWith('/di-demo/layout.ts'));
      return { ownerRouteId: layout.componentRouteId, slot: '0' };
    });
    const forged = await request.post('/crpc', {
      data: {
        service: target,
        action: 'formatCount',
        payload: [],
        state: { count: 0 },
      },
    });
    expect(forged.status()).toBe(403);

    await page.click('a:has-text("Open another page")');
    await page.click('button:has-text("Service redirect home")');
    await expect(page).toHaveURL(/\/$/);
  });
});
