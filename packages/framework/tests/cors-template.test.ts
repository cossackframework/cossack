import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('starter CORS configuration', () => {
  const templateRoot = resolve(import.meta.dirname, '../../scaffold/template');

  it('scaffolds and registers a typed CorsConfig with secure defaults', () => {
    const source = readFileSync(resolve(templateRoot, 'src/config/cors.ts'), 'utf8');
    expect(source).toContain("import type { CorsConfig } from '@cossackframework/framework/cors'");
    expect(source).toContain('interface CossackConfigRegistry');
    expect(source).toContain('cors: CorsConfig');
    expect(source).toContain("env('CORS_ENABLED', 'true')");
    expect(source).toContain("origins(env('CORS_ORIGINS'))");
  });

  it('includes Wrangler CORS variables', () => {
    const source = readFileSync(resolve(templateRoot, 'wrangler.jsonc'), 'utf8');
    expect(source).toContain('"CORS_ORIGINS": ""');
    expect(source).toContain('"CORS_MAX_AGE": "86400"');
  });
});
