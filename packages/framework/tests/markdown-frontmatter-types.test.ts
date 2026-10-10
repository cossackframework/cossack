// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
it('public frontmatter types reject invalid standard fields and validate typed extensions', async () => {
  const require = createRequire(import.meta.url);
  const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  const root = await mkdtemp(path.join(tmpdir(), 'cossack-markdown-types-'));
  try {
    await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true, types: [], paths: { '@cossackframework/framework/markdown-processor': [path.resolve(import.meta.dirname, '../src/markdown-processor.ts')] } }, files: ['index.ts'] }));
    await writeFile(path.join(root, 'index.ts'), `import { createMarkdownProcessor, type MarkdownFrontmatter } from '@cossackframework/framework/markdown-processor';
const standard = { title:'Guide', locale:'fr', aliases:['/fr/guide'], ssg:true } satisfies MarkdownFrontmatter;
const extension = { title:'Guide', readingMinutes:4 } satisfies MarkdownFrontmatter<{readingMinutes:number}>;
// @ts-expect-error Standard titles must be strings.
const invalid = {title:42} satisfies MarkdownFrontmatter;
// @ts-expect-error Unknown metadata requires a declared extension.
const unknown = {undeclared:4} satisfies MarkdownFrontmatter;
// @ts-expect-error Aliases must be strings.
const badAlias = {aliases:[4]} satisfies MarkdownFrontmatter;
// @ts-expect-error SSG is boolean.
const badSsg = {ssg:'true'} satisfies MarkdownFrontmatter;
// @ts-expect-error Extension values retain their declared type.
const badExtension = {readingMinutes:'4'} satisfies MarkdownFrontmatter<{readingMinutes:number}>;
// @ts-expect-error Standard field validation cannot be overridden by an extension.
createMarkdownProcessor<{title:number}>({extensions:{title:(value):value is number => typeof value==='number'}});
const processor = createMarkdownProcessor<{readingMinutes:number}>({extensions:{readingMinutes:(value):value is number => typeof value==='number'}});
processor('# Guide').then(result => { const minutes:number|undefined = result.frontmatter.readingMinutes; });
// @ts-expect-error Extension validators must prove the declared type.
createMarkdownProcessor<{readingMinutes:number}>({extensions:{readingMinutes:(value):value is string => typeof value==='string'}});
`);
    const result = await promisify(execFile)(process.execPath, [compiler, '-p', path.join(root, 'tsconfig.json')], { timeout: 30000 }); expect(result.stdout).toBe('');
  } catch (error: any) { throw new Error(`Public frontmatter types failed: ${error.stdout ?? error.message}`); }
  finally { await rm(root, { recursive: true, force: true }); }
}, 35000);
