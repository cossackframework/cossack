import { test, expect } from '../fixtures';

test.describe('Localization Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/localization-demo');
    await page.waitForLoadState('networkidle');
  });

  test('renders in English by default with the correct <html lang>', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const body = await page.locator('body').textContent();
    expect(body).toContain('Welcome to Cossack Localization');
  });

  test('replaces placeholders with case-aware transforms', async ({ page }) => {
    const body = await page.locator('body').textContent();
    // :name (lowercase) → value as-is
    expect(body).toContain('Hello, world');
    // :NAME (all caps) → uppercased
    expect(body).toContain('Hello, WORLD');
    // :Name (title) → capitalized
    expect(body).toContain('Hello, World');
  });

  test('pluralizes correctly for count=1 and count=5 in English', async ({ page }) => {
    // Initial count is 3 → plural
    let body = await page.locator('body').textContent();
    expect(body).toContain('apples');

    const minus = page.locator('span.w-12').locator('xpath=preceding-sibling::button[1]');
    const plus = page.locator('span.w-12').locator('xpath=following-sibling::button[1]');

    // Decrement to 1 (two clicks from 3) → singular
    await minus.click();
    await minus.click();
    await page.waitForFunction(() => {
      const t = document.body.textContent || '';
      return t.includes('You have 1 apple');
    });
    body = await page.locator('body').textContent();
    expect(body).toContain('You have 1 apple');
    expect(body).not.toContain('You have 1 apples');

    // Increment to 5 (four clicks from 1) → plural
    for (let i = 0; i < 4; i++) {
      await plus.click();
    }
    await page.waitForFunction(() => {
      const t = document.body.textContent || '';
      return t.includes('You have 5 apples');
    });
    body = await page.locator('body').textContent();
    expect(body).toContain('You have 5 apples');
  });

  test('switches to Spanish at runtime and updates <html lang>', async ({ page }) => {
    await page.click('button:has-text("Español")');
    await page.waitForFunction(() => document.documentElement.lang === 'es');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    const body = await page.locator('body').textContent();
    expect(body).toContain('Bienvenido a la Localización');
    expect(body).toContain('Hola, world');
  });

  async function setAppleCount(page: import('@playwright/test').Page, target: number) {
    // The +/- buttons are siblings of the span.w-12 count display. Scope by
    // locating that span first, then clicking its sibling buttons.
    const countSpan = page.locator('span.w-12');
    for (let guard = 0; guard < 20; guard++) {
      const cell = await countSpan.textContent();
      const n = parseInt((cell || '').trim(), 10);
      if (!Number.isFinite(n)) break;
      if (n === target) return;
      // Click the button immediately before (−) or after (+) the span.
      if (n > target) {
        await countSpan.locator('xpath=preceding-sibling::button[1]').click();
      } else {
        await countSpan.locator('xpath=following-sibling::button[1]').click();
      }
    }
  }

  test('uses Russian plural rules (3 forms) after switching', async ({ page }) => {
    await page.click('button:has-text("Русский")');
    await page.waitForFunction(() => document.documentElement.lang === 'ru');

    // count = 1 → "яблоко" (one)
    await setAppleCount(page, 1);
    await page.waitForFunction(() => (document.body.textContent || '').includes('У вас 1 яблоко'));
    let body = await page.locator('body').textContent();
    expect(body).toContain('У вас 1 яблоко');

    // count = 2 → "яблока" (few)
    await setAppleCount(page, 2);
    await page.waitForFunction(() => (document.body.textContent || '').includes('У вас 2 яблока'));
    body = await page.locator('body').textContent();
    expect(body).toContain('У вас 2 яблока');

    // count = 5 → "яблок" (many)
    await setAppleCount(page, 5);
    await page.waitForFunction(() => (document.body.textContent || '').includes('У вас 5 яблок'));
    body = await page.locator('body').textContent();
    expect(body).toContain('У вас 5 яблок');
  });

  test('persists locale choice across reload via cookie', async ({ page }) => {
    await page.click('button:has-text("Español")');
    await page.waitForFunction(() => document.documentElement.lang === 'es');

    await page.reload();
    await page.waitForLoadState('networkidle');
    // The server reads the cossack_locale cookie and SSRs in Spanish.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    const body = await page.locator('body').textContent();
    expect(body).toContain('Bienvenido a la Localización');
  });

  test('falls back to the key when a translation is missing', async ({ page }) => {
    const body = await page.locator('body').textContent();
    expect(body).toContain('this.key.does.not.exist');
  });

  test('supports translation strings as keys', async ({ page }) => {
    const body = await page.locator('body').textContent();
    expect(body).toContain('I love programming.');
  });
});
