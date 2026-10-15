import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { isPublicFileRequest } from '../src/development-assets';

let root: string;
let publicDir: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cossack-desktop-public-'));
  publicDir = path.join(root, 'public');
  await mkdir(path.join(publicDir, 'vault'), { recursive: true });
  await writeFile(path.join(publicDir, 'vault/record.txt'), 'vault record');
  await writeFile(path.join(publicDir, 'space name.txt'), 'space');
  await writeFile(path.join(root, 'secret.txt'), 'outside public');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const check = (url: string, init?: RequestInit) => isPublicFileRequest(new Request(url, init), publicDir);

it('recognizes plain GET and HEAD requests for files in the public directory', async () => {
  expect(await check('https://app/vault/record.txt')).toBe(true);
  expect(await check('https://app/vault/record.txt', { method: 'HEAD' })).toBe(true);
  expect(await check('https://app/vault/record.txt?v=1')).toBe(true);
  expect(await check('https://app/space%20name.txt')).toBe(true);
});

it('leaves module, internal, missing and non-file requests to Vite', async () => {
  expect(await check('https://app/vault/record.txt', { method: 'POST', body: 'x' })).toBe(false);
  expect(await check('https://app/vault/record.txt?import')).toBe(false);
  expect(await check('https://app/vault/record.txt?url')).toBe(false);
  expect(await check('https://app/@vite/client')).toBe(false);
  expect(await check('https://app/@fs/vault/record.txt')).toBe(false);
  expect(await check('https://app/vault')).toBe(false);
  expect(await check('https://app/')).toBe(false);
  expect(await check('https://app/vault/missing.txt')).toBe(false);
  expect(await check('https://app/%E0%A4%A')).toBe(false);
  expect(await isPublicFileRequest(new Request('https://app/vault/record.txt'), '')).toBe(false);
});

it('never classifies a file outside the public directory', async () => {
  // URL parsing removes dot segments; encoded separators must not restore them.
  expect(await check('https://app/../secret.txt')).toBe(false);
  expect(await check('https://app/..%5Csecret.txt')).toBe(false);
  expect(await check('https://app/..%2Fsecret.txt')).toBe(false);
  expect(await check('https://app/vault/..%2F..%2Fsecret.txt')).toBe(false);
});
