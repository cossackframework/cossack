// src/shared/environment.ts
export const isServer = typeof window === 'undefined' || typeof window.document === 'undefined';
