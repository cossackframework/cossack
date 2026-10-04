import { test, expect } from '../fixtures';

test('edits controlled settings through labeled native controls and explicit actions', async ({ page }) => {
    await page.goto('/blocks/settings');
    await page.waitForFunction(() => (window as any).__cossackReady === true);
    const name = page.getByLabel('Display name', { exact: true });
    const email = page.getByRole('switch', { name: 'Email notifications', exact: true });
    await expect(name).toHaveValue('Jane Doe');
    await name.fill('Updated profile'); await expect(name).toHaveValue('Updated profile');
    await email.focus(); await page.keyboard.press('Space'); await expect(email).not.toBeChecked();
    await expect(email).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Requested action' })).toContainText('delete');
    await expect(name).toHaveValue('Updated profile');
    await page.setViewportSize({ width: 320, height: 900 });
    // The app shell animates its sidebar width after crossing the mobile breakpoint.
    await expect.poll(() => page.locator('#account-settings').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
