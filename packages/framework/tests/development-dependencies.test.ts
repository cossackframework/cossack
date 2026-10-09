import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { UserConfig } from 'vite';
import configuration from '../vite.config';

function iconImports(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return iconImports(file);
    if (!entry.name.endsWith('.ts')) return [];
    return [...readFileSync(file, 'utf8').matchAll(/["'](@cossackframework\/solar-icons\/[^"']+)["']/g)]
      .map(match => match[1]).filter(name => !name.endsWith('/types'));
  });
}

describe('demo development dependency discovery', () => {
  const config = configuration as UserConfig;
  it('pre-bundles every authored deep icon import in both environments', () => {
    const expected = [...new Set(iconImports(fileURLToPath(new URL('../src', import.meta.url))))];
    expect(expected.length).toBeGreaterThan(0);
    for (const environment of ['client', 'ssr']) {
      const included = config.environments?.[environment]?.optimizeDeps?.include ?? [];
      for (const specifier of expected) expect(included).toContain(specifier);
      expect(included).not.toContain('@cossackframework/solar-icons');
    }
  });
  it('pre-bundles storage SDKs only on the server without disabling discovery', () => {
    const sdks = ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'];
    for (const sdk of sdks) {
      expect(config.environments?.ssr?.optimizeDeps?.include).toContain(sdk);
      expect(config.environments?.client?.optimizeDeps?.include).not.toContain(sdk);
    }
    for (const environment of ['client', 'ssr']) {
      expect(config.environments?.[environment]?.optimizeDeps?.noDiscovery).not.toBe(true);
    }
  });
});
