import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findCloudflareConfig } from '../src/config-preflight.js';

describe('Cloudflare configuration path selection', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cossack-config-path-'));
    vi.stubEnv('CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH', '');
    await mkdir(join(root, 'config'));
    for (const name of ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml', 'config/selected.jsonc', 'config/environment.jsonc']) {
      await writeFile(join(root, name), '{}');
    }
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it.each(['config/selected.jsonc', 'absolute'])('prioritizes an explicit %s path over the environment and defaults', async (selection) => {
    vi.stubEnv('CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH', 'config/environment.jsonc');
    const explicit = selection === 'absolute' ? join(root, 'config/selected.jsonc') : selection;
    expect(await findCloudflareConfig(root, explicit)).toBe(join(root, 'config/selected.jsonc'));
  });

  it.each(['config/environment.jsonc', 'absolute'])('prioritizes an environment %s path over defaults', async (selection) => {
    vi.stubEnv('CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH', selection === 'absolute' ? join(root, 'config/environment.jsonc') : selection);
    expect(await findCloudflareConfig(root)).toBe(join(root, 'config/environment.jsonc'));
  });

  it('does not fall back when an explicit path is missing', async () => {
    vi.stubEnv('CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH', 'config/environment.jsonc');
    expect(await findCloudflareConfig(root, 'config/missing.jsonc')).toBeUndefined();
  });

  it('does not fall back when the environment path is missing', async () => {
    vi.stubEnv('CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH', 'config/missing.jsonc');
    expect(await findCloudflareConfig(root)).toBeUndefined();
  });

  it('keeps the standard jsonc, json, then toml priority with an empty environment path', async () => {
    expect(await findCloudflareConfig(root)).toBe(join(root, 'wrangler.jsonc'));
    await rm(join(root, 'wrangler.jsonc'));
    expect(await findCloudflareConfig(root)).toBe(join(root, 'wrangler.json'));
    await rm(join(root, 'wrangler.json'));
    expect(await findCloudflareConfig(root)).toBe(join(root, 'wrangler.toml'));
    await rm(join(root, 'wrangler.toml'));
    expect(await findCloudflareConfig(root)).toBeUndefined();
  });
});
