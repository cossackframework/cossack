import { defineDesktopBindings } from '@cossackframework/deno-adapter/desktop';

const STORAGE_KEY = 'cossack.desktop.counter';

export const desktopBindings = defineDesktopBindings({
  loadCount(): number {
    const value = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10);
    return Number.isFinite(value) ? value : 0;
  },
  saveCount(count: number): void {
    if (!Number.isSafeInteger(count)) throw new TypeError('count must be a safe integer');
    localStorage.setItem(STORAGE_KEY, String(count));
  },
});
