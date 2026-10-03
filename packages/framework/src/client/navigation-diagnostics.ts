import type { NavigateResult, NavigationScrollBehavior, NavigationType } from '@cossackframework/core';

/** Fixed fields intentionally exclude URLs, state, application identifiers and raw errors. */
export type NavigationDiagnostic =
  | { phase: 'start'; navigationType: NavigationType }
  | { phase: 'cache'; decision: 'hit' | 'miss' | 'shared' }
  | { phase: 'invalidate'; entries: number }
  | { phase: 'layouts'; retained: number; created: number; retired: number; rootReplaced: boolean }
  | { phase: 'scroll'; behavior: NavigationScrollBehavior; decision: 'unavailable' | 'preserve' | 'history' | 'top' | 'fragment' | 'fragment-missing' }
  | { phase: 'transition'; decision: 'disabled' | 'unsupported' | 'callback' | 'typed' | 'types-unsupported' | 'animation-skipped' }
  | { phase: 'finish'; outcome: NavigateResult['outcome']; committed: boolean };

export type NavigationTrace = (event: NavigationDiagnostic) => void;
let sequence = 0;

export function emitNavigationDiagnostic(navigationId: number | null, event: NavigationDiagnostic): void {
  if (!import.meta.env.DEV || typeof document === 'undefined') return;
  const detail = Object.freeze({ version: 1, navigationId, timestamp: performance.now(), ...event });
  document.dispatchEvent(new CustomEvent('cossack:navigation-diagnostic', { detail }));
}

export function createNavigationTrace(): NavigationTrace {
  const id = ++sequence;
  return event => emitNavigationDiagnostic(id, event);
}
