import { test, expect } from '@playwright/test';
import { waitForHydration } from '../fixtures/helpers';

test('opens the composed command palette, selects grouped results and restores focus', async ({ page }) => {
    await page.goto('/blocks/command-palette');
    await waitForHydration(page);
    const trigger = page.getByRole('button', { name: 'Open command palette', exact: true });
    await trigger.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Application commands' });
    const search = dialog.getByRole('combobox', { name: 'Search application commands' });
    await expect(dialog).toBeVisible(); await expect(search).toBeFocused();
    await expect(dialog.getByRole('group', { name: 'Actions', exact: true })).toBeVisible();
    await search.fill('Create new post'); await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Last selected' })).toContainText('new-post');
    await trigger.press('Enter'); await expect(search).toHaveValue('');
    await search.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
});
