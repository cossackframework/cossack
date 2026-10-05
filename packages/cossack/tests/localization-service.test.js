import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript-api';
import { inspectLocalization, generateLocalizationTypes } from '../src/localization-service.js';
let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-localization-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(file, value) { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, typeof value === 'string' ? value : JSON.stringify(value)); }
const codes = result => result.diagnostics.map(item => item.code);
describe('localization inspection', () => {
  it('extracts globals, imported aliases, reexports and namespace calls with locations, not unrelated or shadowed methods', async () => {
    await write('src/lang/en.json', { hello: 'Hello' });
    await write('src/messages.ts', `export { __ as translate } from '@cossackframework/core';`);
    await write('src/page.ts', `import { translate as t } from './messages.js';\nimport * as core from '@cossackframework/core';\n__('hello'); t('hello'); core.__('hello'); unrelated.__('ignored');\nfunction scoped(__: (x:string)=>string) { __('ignored'); }\nfunction other(t: (x:string)=>string) { t('ignored'); }\n// __('comment')\nconst text = "__('string')";`);
    const result = await inspectLocalization(root);
    expect(result.valid).toBe(true);
    expect(result.calls.map(call => call.key)).toEqual(['hello', 'hello', 'hello']);
    expect(result.calls.every(call => call.line === 3 && call.column > 0 && call.file === 'src/page.ts')).toBe(true);
  });
  it('reports dynamic keys and params explicitly without executing application code', async () => {
    await write('src/lang/en.json', { welcome: 'Hello :name' });
    await write('src/page.ts', "throw new Error('DO NOT EXECUTE'); __('welcome', params); __(key); __(`hello ${key}`);");
    const result = await inspectLocalization(root);
    expect(result.unresolved).toHaveLength(2);
    expect(codes(result)).toContain('COSSACK_LANG_DYNAMIC_PARAMETERS');
    expect(codes(result)).toContain('COSSACK_LANG_DYNAMIC_KEY');
    expect(result.calls.map(call => call.key)).toEqual(['welcome']);
  });
  it('reports missing keys, fallback and unused keys without echoing catalog values', async () => {
    await write('src/lang/en.json', { used: 'PRIVATE VALUE', unused: 'UNUSED VALUE' });
    await write('src/lang/es.json', { used: 'Spanish' });
    await write('src/page.ts', `__('used'); __('unknown');`);
    const result = await inspectLocalization(root);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_LANG_KEY_MISSING', locale: 'es', key: 'unused', fallback: 'en' }));
    expect(codes(result)).toContain('COSSACK_LANG_KEY_UNKNOWN');
    expect(codes(result)).toContain('COSSACK_LANG_KEY_UNUSED');
    expect(JSON.stringify(result)).not.toContain('PRIVATE VALUE');
    expect(JSON.stringify(result)).not.toContain('UNUSED VALUE');
  });
  it('normalizes placeholder case and permits locale-specific plural counts', async () => {
    await write('src/lang/en.json', { apples: ':count apple for :Name|:count apples for :Name' });
    await write('src/lang/ru.json', { apples: ':count :name a|:count :name b|:count :name c|:count :name d' });
    await write('src/page.ts', `__('apples', { count: 2, name: 'Sam' });`);
    const result = await inspectLocalization(root);
    expect(result.valid).toBe(true);
    expect(result.contracts.apples).toEqual({ parameters: ['count', 'name'], plural: true });
    expect(generateLocalizationTypes(result)).toContain('"count": number; "name": string | number');
  });
  it('rejects renamed placeholders, inconsistent variants, absent count and empty variants', async () => {
    await write('src/lang/en.json', { apples: ':count apple :name|:count apples :name' });
    await write('src/lang/es.json', { apples: ':count :person|empty|' });
    await write('src/page.ts', `__('apples', { name: 'Sam' });`);
    const result = await inspectLocalization(root);
    expect(codes(result)).toEqual(expect.arrayContaining(['COSSACK_LANG_PLACEHOLDERS_MISMATCH', 'COSSACK_LANG_PLURAL_PARAMETERS', 'COSSACK_LANG_PLURAL_INVALID', 'COSSACK_LANG_PARAMETERS_MISSING']));
    expect(() => generateLocalizationTypes(result)).toThrow('Fix localization errors');
  });
  it('selects the default/fallback catalog and preserves intentional string keys', async () => {
    await write('src/lang/fr.json', { 'Bonjour !': 'Bonjour !' });
    await write('src/page.ts', "__(`Bonjour !`);");
    const result = await inspectLocalization(root, { locale: 'fr' });
    expect(result.valid).toBe(true);
    expect(result.defaultLocale).toBe('fr');
    expect(result.fallbackLocale).toBe('fr');
    expect(generateLocalizationTypes(result)).toContain('"Bonjour !": {  }');
  });
  it('rejects malformed catalogs with fixed diagnostics and locale path traversal', async () => {
    await write('src/lang/en.json', '{"private": MALFORMED_PRIVATE_VALUE}');
    const result = await inspectLocalization(root);
    expect(codes(result)).toContain('COSSACK_LANG_CATALOG_INVALID');
    expect(JSON.stringify(result)).not.toContain('MALFORMED_PRIVATE_VALUE');
    await expect(inspectLocalization(root, { locale: '../escape' })).rejects.toMatchObject({ code: 'COSSACK_LANG_LOCALE_INVALID' });
  });
  it('does not follow symlinked sources or catalogs', async () => {
    await write('outside/en.json', { leaked: 'PRIVATE' });
    await fs.mkdir(path.join(root, 'src/lang'), { recursive: true });
    await fs.symlink(path.join(root, 'outside/en.json'), path.join(root, 'src/lang/en.json'));
    const result = await inspectLocalization(root);
    expect(codes(result)).toContain('COSSACK_LANG_SOURCE_UNSAFE');
    expect(result.calls).toEqual([]);
  });
  it('rejects empty translations and unsupported plural counts', async () => {
    await write('src/lang/en.json', { empty: '', many: 'a|b|c|d|e|f|g' });
    const result = await inspectLocalization(root);
    expect(codes(result)).toContain('COSSACK_LANG_TRANSLATION_EMPTY');
    expect(codes(result)).toContain('COSSACK_LANG_PLURAL_INVALID');
  });
  it('resolves forwarded reexports and excludes type-only imports and lexical shadows', async () => {
    await write('src/lang/en.json', { hello: 'Hello' });
    await write('src/forward.ts', "import { __ as translate } from '@cossackframework/core'; export { translate as t };");
    await write('src/page.ts', "import { t } from './forward'; import type { __ } from '@cossackframework/core'; t('hello'); __('ignored'); for (let t of items) t('ignored'); try {} catch(t) { t('ignored'); } function forward({ t: other }) { t('hello'); }");
    const result = await inspectLocalization(root);
    expect(result.calls.map(call => call.key)).toEqual(['hello', 'hello']);
    expect(result.valid).toBe(true);
  });
  it('reports invalid source syntax without including parser details', async () => {
    await write('src/lang/en.json', { hello: 'Hello' });
    await write('src/page.ts', "__('hello'; PRIVATE_INVALID_SYNTAX");
    const result = await inspectLocalization(root);
    expect(codes(result)).toContain('COSSACK_LANG_SOURCE_INVALID');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_INVALID_SYNTAX');
    expect(result.calls).toEqual([]);
  });
  it('generated registry enforces the actual core translation signature', async () => {
    await write('src/lang/en.json', { hello: 'Hello', welcome: 'Hello :name', apples: ':count apple|:count apples' });
    await write('src/page.ts', "__('hello'); __('welcome', { name: 'Sam' }); __('apples', { count: 1 });");
    const result = await inspectLocalization(root);
    await write('translations.d.ts', generateLocalizationTypes(result));
    await write('typecheck.ts', `import { __ } from '@cossackframework/core';
      __('hello'); __('welcome', { name: 'Sam' }); __('apples', { count: 1 });
      // @ts-expect-error Unknown key.
      __('unknown');
      // @ts-expect-error Required name.
      __('welcome');
      // @ts-expect-error Wrong parameter name.
      __('welcome', { renamed: 'Sam' });
      // @ts-expect-error Numeric plural count.
      __('apples', { count: '1' });
    `);
    const program = ts.createProgram([path.join(root, 'translations.d.ts'), path.join(root, 'typecheck.ts')], {
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true, skipLibCheck: true, noEmit: true, types: [],
      paths: { '@cossackframework/core': [path.resolve(import.meta.dirname, '../../core/src/shared/i18n.ts')] },
    });
    const errors = ts.getPreEmitDiagnostics(program);
    expect(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n'))).toEqual([]);
  });

});
