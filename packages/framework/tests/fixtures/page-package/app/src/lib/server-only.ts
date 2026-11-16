import { readFileSync } from 'node:fs';

/** Server-only by its import: the browser gets a stub. */
export function readSecret(): string {
  return 'KIT_ONLY_SERVER' + typeof readFileSync;
}
