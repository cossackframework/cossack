import { createDevelopmentNavigationTrace, type DevelopmentNavigationDiagnostic, type DevelopmentComponentRole } from '@cossackframework/core/devtools';

/** Shared fixed fields exclude URLs, state, application identifiers and raw errors. */
export type NavigationDiagnostic = DevelopmentNavigationDiagnostic;
export type NavigationTrace = ((event: NavigationDiagnostic) => void) & {
  bindComponent?: (component: object, role: DevelopmentComponentRole) => void;
};
let sequence = 0;

export function emitNavigationDiagnostic(navigationId: number | null, event: NavigationDiagnostic): void {
  if (!import.meta.env.DEV || typeof document === 'undefined') return;
  if (navigationId === null) createDevelopmentNavigationTrace(null)?.record(event);
  const detail = Object.freeze({ version: 1, navigationId, timestamp: performance.now(), ...event });
  document.dispatchEvent(new CustomEvent('cossack:navigation-diagnostic', { detail }));
}

export function createNavigationTrace(): NavigationTrace {
  const id = ++sequence;
  const capture = import.meta.env.DEV ? createDevelopmentNavigationTrace(id) : undefined;
  const trace: NavigationTrace = event => {
    capture?.record(event);
    emitNavigationDiagnostic(id, event);
  };
  trace.bindComponent = (component, role) => capture?.component(component, role);
  return trace;
}
