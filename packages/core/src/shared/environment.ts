// src/shared/environment.ts
// The library build redirects internal imports through #cossack-environment.
// Its browser condition selects a constant; other runtimes keep this portable
// check, including direct Node/Workers consumers without an application build.
export const isServer = typeof window === 'undefined' || typeof window.document === 'undefined';
