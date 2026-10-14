import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { transformSync } from 'esbuild';
import { createApp, renderRecipe, resolveRecipe } from '../src/index.js';
import { projectNameProblem } from '../src/registry.js';

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

/** JSONC is a JavaScript expression; evaluate our own generated output to read it. */
function parseJsonc(text) {
  return new Function(`return (${text});`)();
}

function syntaxErrors(file, text) {
  try {
    transformSync(text, { loader: 'ts', sourcefile: file });
    return [];
  } catch (error) {
    return error.errors?.map(item => item.text) ?? [String(error)];
  }
}

describe('project name validation', () => {
  it.each(['my-app', 'app2', 'a', 'cossack-app-2026'])('accepts %s', name => {
    expect(projectNameProblem(name)).toBeNull();
  });

  it.each([
    ['My-App', /lowercase/],
    ['my_app', /lowercase letters, digits and dashes/],
    ['my app', /lowercase letters, digits and dashes/],
    ['-app', /start and end/],
    ['app-', /start and end/],
    ['.hidden', /lowercase letters, digits and dashes/],
    ['a'.repeat(64), /63/],
    ['http', /Node\.js built-in/],
    ['', /empty/],
  ])('rejects %j', (name, message) => {
    expect(projectNameProblem(name)).toMatch(message);
  });

  it('createApp rejects an invalid name before writing anything', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-name-'));
    temporaryDirectories.push(root);
    await expect(createApp('Bad Name', { cwd: root, adapter: 'cloudflare', preset: 'minimal', interactive: false }))
      .rejects.toMatchObject({ code: 'COSSACK_PROJECT_NAME_INVALID' });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('createApp validates only the final path segment', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-name-'));
    temporaryDirectories.push(root);
    const result = await createApp('Nested Dir/my-app', { cwd: root, adapter: 'cloudflare', preset: 'minimal', interactive: false, dryRun: true });
    expect(result.status).toBe('dry-run');
  });
});

describe('generated files escape the project name', () => {
  // Existing projects keep their directory name, which may hold any character.
  const name = 'we"ird\'s \\ app';

  it('keeps wrangler.jsonc valid JSONC for every feature', async () => {
    const recipe = resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: 'database,jobs,workflows' });
    const files = await renderRecipe(recipe, { projectName: name });
    const config = parseJsonc(files.get('wrangler.jsonc').content.toString('utf8'));
    expect(config.name).toBe(name);
    expect(config.d1_databases.map(database => database.database_name)).toEqual([`${name}-db`, `${name}-job-state`]);
    expect(config.queues.producers[0].queue).toBe(`${name}-jobs`);
    expect(config.workflows[0].name).toBe(`${name}-approval`);
    expect(config.vars.JOB_NAMESPACE).toBe(`${name}-jobs-default`);
  });

  it('keeps desktop TypeScript entries syntactically valid', async () => {
    const recipe = resolveRecipe({ adapter: 'node', preset: 'minimal', features: 'desktop' });
    const files = await renderRecipe(recipe, { projectName: name });
    for (const [file, entry] of files) {
      if (!/desktop|forge/.test(file) || !/\.ts$/.test(file)) continue;
      const text = entry.content.toString('utf8');
      expect(syntaxErrors(file, text), file).toEqual([]);
      if (text.includes('productName')) expect(text).toContain(JSON.stringify(name));
    }
  });
});
