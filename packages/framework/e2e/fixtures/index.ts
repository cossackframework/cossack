import { test as base, Page } from '@playwright/test';

export interface CossackTestFixtures {
  waitForWebSocket: () => Promise<void>;
  waitForStateUpdate: (expectedState: Record<string, unknown>) => Promise<void>;
}

export const test = base.extend<CossackTestFixtures>({
  waitForWebSocket: async ({ page }, use) => {
    await use(async () => {
      await page.waitForFunction(() => {
        return (window as unknown as { __WS_CONNECTED__?: boolean }).__WS_CONNECTED__ === true;
      });
    });
  },

  waitForStateUpdate: async ({ page }, use) => {
    await use(async (expectedState: Record<string, unknown>) => {
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
    });
  },
});

export { expect } from '@playwright/test';
