// @vitest-environment node
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fs = require('node:fs') as typeof import('node:fs');
const packages = ['core', 'framework', 'auth', 'node-adapter', 'database'] as const;

describe('Hono package contract', () => {
  it.each(packages)('%s uses the common Hono peer supplied by the consumer', (packageName) => {
    const packageJson = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), '..', packageName, 'package.json'),
      'utf8',
    ));

    expect(packageJson.peerDependencies?.hono).toBe('^4.12.0');
    expect(packageJson.dependencies?.hono).toBeUndefined();
    expect(packageJson.devDependencies?.hono).toMatch(/^\^4\.12\./);
  });
});
