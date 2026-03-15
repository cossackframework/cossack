import { Page } from '@playwright/test';

export async function waitForWebSocketConnection(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return (window as unknown as { __WS_CONNECTED__?: boolean }).__WS_CONNECTED__ === true;
  });
}

export async function waitForStateUpdate(
  page: Page,
  expectedState: Record<string, unknown>
): Promise<void> {
  await page.waitForFunction((expected) => {
    const initialState = (window as unknown as { __INITIAL_STATE__?: Record<string, unknown> }).__INITIAL_STATE__;
    if (!initialState) return false;

    for (const [key, value] of Object.entries(expected)) {
      if (JSON.stringify(initialState[key]) !== JSON.stringify(value)) {
        return false;
      }
    }
    return true;
  }, expectedState);
}

export async function getState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    return (window as unknown as { __INITIAL_STATE__?: Record<string, unknown> }).__INITIAL_STATE__ || {};
  });
}

export async function clickAndWaitForNavigation(page: Page, selector: string): Promise<void> {
  await Promise.all([
    page.waitForURL(/.*/),
    page.click(selector),
  ]);
}

export async function waitForLoadingComplete(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

export async function getElementText(page: Page, selector: string): Promise<string> {
  const element = page.locator(selector);
  return (await element.textContent()) || '';
}
