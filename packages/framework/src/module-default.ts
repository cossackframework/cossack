/** Components are default exports. Named helpers must not affect selection. */
export function getModuleDefault(module: unknown): unknown {
  return module !== null && typeof module === 'object'
    ? (module as { default?: unknown }).default
    : undefined;
}
