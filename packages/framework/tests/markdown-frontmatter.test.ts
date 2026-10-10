// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMarkdownProcessor, processMarkdown } from '../src/markdown-processor';
import { isValidatedMarkdownFrontmatter, MarkdownFrontmatterError, validateMarkdownFrontmatter } from '../src/markdown-frontmatter';
describe('Markdown frontmatter contract', () => {
  it('accepts all standard metadata and preserves source content rendering', async () => {
    const result = await processMarkdown(`---\ntitle: Article\ndescription: Details\nimage: /image.png\nauthor: Ada\ndate: 2024-02-29\nlocale: fr-CA\ncanonical: /fr/article\naliases: [/fr/guide, /fr/other]\nssg: true\n---\n# Content`, 'src/pages/fr/article.md');
    expect(result.frontmatter).toMatchObject({ title: 'Article', date: '2024-02-29', locale: 'fr-CA', canonical: '/fr/article', aliases: ['/fr/guide', '/fr/other'], ssg: true });
    expect(result.html).toContain('<h1 id="content">Content</h1>');
    expect(isValidatedMarkdownFrontmatter(result.frontmatter)).toBe(true);
    expect(Object.isFrozen(result.frontmatter)).toBe(true); expect(Object.isFrozen(result.frontmatter.aliases)).toBe(true);
  });
  it.each(['title', 'description', 'image', 'author', 'date', 'locale', 'canonical'])('reports incorrect %s types at their actual source key', async field => {
    try { await processMarkdown(`---\n${field}: 27\n---\n# Content`, 'src/pages/article.md'); throw new Error('Expected metadata rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(MarkdownFrontmatterError);
      expect((error as MarkdownFrontmatterError).diagnostics[0]).toMatchObject({ field, source: { file: 'src/pages/article.md', line: 2, column: 1 }, expected: 'a string' });
      expect((error as Error).message).not.toContain('27');
    }
  });
  it('locates quoted field names and does not include rejected private strings', async () => {
    await expect(processMarkdown('---\n"locale": PRIVATE_SECRET_SENTINEL\n---\n# Content', 'src/pages/article.mdx')).rejects.toMatchObject({ diagnostics: [{ field: 'locale', source: { file: 'src/pages/article.mdx', line: 2, column: 1 } }] });
    try { await processMarkdown('---\nlocale: PRIVATE_SECRET_SENTINEL\n---'); } catch (error) { expect(JSON.stringify(error)).not.toContain('PRIVATE_SECRET_SENTINEL'); expect((error as Error).message).not.toContain('PRIVATE_SECRET_SENTINEL'); }
  });
  it.each([{ date: '2023-02-29' }, { date: '2024-13-01' }, { locale: 'not_a_locale' }, { canonical: 'javascript:alert(1)' }, { canonical: 'https://user:secret@example.com/x' }, { ssg: 'yes' }, { aliases: ['/x/:slug'] }, { aliases: ['/x/[slug]'] }, { aliases: ['/x/%2e%2e/y'] }, { aliases: ['/x?query=private'] }, { aliases: '//outside' }, { aliases: ['/x'], ssg: false }])('rejects invalid standard shapes %j', value => {
    expect(() => validateMarkdownFrontmatter(value)).toThrow(MarkdownFrontmatterError);
  });
  it('rejects undeclared fields and accepts an explicit typed extension processor', async () => {
    await expect(processMarkdown('---\nreadingMinutes: 4\n---\n# Content', 'article.md')).rejects.toMatchObject({ diagnostics: [{ code: 'COSSACK_MARKDOWN_FRONTMATTER_UNKNOWN_FIELD', field: 'readingMinutes' }] });
    const processor = createMarkdownProcessor<{ readingMinutes: number }>({ extensions: { readingMinutes: (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 } });
    const result = await processor('---\ntitle: Guide\nreadingMinutes: 4\n---\n# Content', 'article.md');
    expect(result.frontmatter.readingMinutes).toBe(4); expect(Object.isFrozen(processor.frontmatterExtensions)).toBe(true); expect(isValidatedMarkdownFrontmatter(result.frontmatter)).toBe(true);
    await expect(processor('---\nreadingMinutes: private\n---')).rejects.toThrow(MarkdownFrontmatterError);
  });
  it('redacts extension callback failures and refuses standard field overrides', () => {
    const extensions = { readingMinutes: ((_value: unknown): _value is number => { throw new Error('PRIVATE_CALLBACK'); }) };
    try { validateMarkdownFrontmatter({ readingMinutes: 4 }, { extensions }); } catch (error) { expect((error as Error).message).not.toContain('PRIVATE_CALLBACK'); }
    expect(() => validateMarkdownFrontmatter({ title: 'Guide' }, { extensions: { title: (_value: unknown): _value is string => true } } as any)).toThrow(MarkdownFrontmatterError);
  });
  it('does not read authored accessors or trust a copied validation result', () => {
    const getter = vi.fn(() => 'PRIVATE_GETTER'); const value = Object.defineProperty({}, 'title', { get: getter, enumerable: true });
    expect(() => validateMarkdownFrontmatter(value)).toThrow(MarkdownFrontmatterError); expect(getter).not.toHaveBeenCalled();
    const aliases = ['safe']; Object.defineProperty(aliases, '0', { get: getter });
    expect(() => validateMarkdownFrontmatter({ aliases })).toThrow(MarkdownFrontmatterError); expect(getter).not.toHaveBeenCalled();
    const valid = validateMarkdownFrontmatter({ title: 'Guide' }); expect(isValidatedMarkdownFrontmatter({ ...valid })).toBe(false);
  });
  it('rejects malformed YAML without parser values in public diagnostics', async () => {
    try { await processMarkdown('---\ntitle: [PRIVATE_BAD_YAML\n---\n# Content', 'article.md'); throw new Error('Expected invalid YAML'); }
    catch (error) { expect(error).toBeInstanceOf(MarkdownFrontmatterError); expect((error as Error).message).not.toContain('PRIVATE_BAD_YAML'); expect((error as MarkdownFrontmatterError).diagnostics[0].source.file).toBe('article.md'); }
  });
});

it('rejects encoded alias spelling and duplicate normalized output paths', () => {
  expect(() => validateMarkdownFrontmatter({ aliases: ['/guide', '/%67uide'] })).toThrow(MarkdownFrontmatterError);
  expect(() => validateMarkdownFrontmatter({ aliases: ['/guide', '/guide/'] })).toThrow(MarkdownFrontmatterError);
  expect(() => validateMarkdownFrontmatter({ aliases: ['/', '/'] })).toThrow(MarkdownFrontmatterError);
  expect(validateMarkdownFrontmatter({ canonical: '/%67uide', aliases: ['/guide'] }).canonical).toBe('/%67uide');
});
