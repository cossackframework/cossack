import { Page } from '@playwright/test';

/** Resolves once the client bundle has hydrated and attached event listeners. */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cossackReady?: boolean }).__cossackReady === true);
}

/** The server-serialized hydration payload (`window.__INITIAL_STATE__`). */
export async function getState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    return (window as unknown as { __INITIAL_STATE__?: Record<string, unknown> }).__INITIAL_STATE__ || {};
  });
}
