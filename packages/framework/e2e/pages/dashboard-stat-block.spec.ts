import { test, expect } from '../fixtures';

test('renders the shared metric list with explicit change meaning and responsive columns', async ({ page }) => {
    await page.goto('/blocks/dashboard');
    await page.waitForFunction(() => (window as any).__cossackReady === true);
    const metrics = page.getByRole('list', { name: 'Overview metrics' });
    await expect(metrics.getByRole('listitem')).toHaveCount(4);
    await expect(metrics.locator('[data-stat-id="revenue"]')).toContainText('Favorable');
    await expect(metrics.locator('[data-stat-id="orders"]')).toContainText('Unfavorable');
    await expect(metrics).not.toContainText(')}');
    for (const width of [320, 1400]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => metrics.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(width === 320 ? 1 : 4);
        expect(await metrics.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
});
