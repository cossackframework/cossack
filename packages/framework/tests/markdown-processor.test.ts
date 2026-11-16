import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { processMarkdown } from '../src/markdown-processor';
import { cossackPages } from '../src/vite-plugin';

/** A project with one TypeScript page and two Markdown pages. */
function markdownProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'cossack-markdown-'));
  mkdirSync(join(root, 'src/pages'), { recursive: true });
  writeFileSync(join(root, 'src/pages/index.ts'), 'export default class Page {}');
  writeFileSync(join(root, 'src/pages/guide.md'), '# Guide');
  writeFileSync(join(root, 'src/pages/notes.mdx'), '# Notes');
  return root;
}

describe('Markdown processor', () => {
  it('omits Markdown routes and warns once when no processor is configured', async () => {
    // Template checks run in buildStart too; they would check this whole package.
    const plugin = cossackPages({ templateDiagnostics: false });
    const load = plugin.load as Function;
    const root = markdownProject();
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    const virtual = load.call(
      { environment: { name: 'client' } },
      '\0virtual:cossack-pages',
    );
    expect(virtual).toContain('"/src/pages/index.ts": () => import("/src/pages/index.ts")');
    expect(virtual).not.toContain('guide.md');
    expect(virtual).not.toContain('notes.mdx');

    const warn = vi.fn();
    const buildStart = plugin.buildStart as Function;
    await buildStart.call({ warn });
    await buildStart.call({ warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cossack add markdown'));
  });

  it('includes Markdown route globs only when a processor is configured', () => {
    const plugin = cossackPages({ markdownProcessor: processMarkdown });
    (plugin.configResolved as Function).call({}, { root: markdownProject(), publicDir: false, base: '/' });
    const source = (plugin.load as Function).call(
      { environment: { name: 'ssr' } },
      '\0virtual:cossack-pages',
    ) as string;
    // The server imports every page eagerly, Markdown pages included.
    expect(source).toMatch(/import \* as (\w+) from "\/src\/pages\/guide\.md";[\s\S]*"\/src\/pages\/guide\.md": \1,/);
    expect(source).toMatch(/import \* as \w+ from "\/src\/pages\/notes\.mdx";/);
    expect(source).not.toContain('() => import(');
  });

  it('extracts frontmatter and renders CommonMark, GFM, raw HTML, and slugs', async () => {
    const result = await processMarkdown(`---
title: Guide
description: Read it
image: /guide.png
---
# Hello World

~~removed~~ https://example.com

<aside data-test="raw"><b>trusted</b></aside>
`);

    expect(result.frontmatter).toEqual({
      title: 'Guide', description: 'Read it', image: '/guide.png',
    });
    expect(result.html).not.toContain('title: Guide');
    expect(result.html).toContain('<h1 id="hello-world">Hello World</h1>');
    expect(result.html).toContain('<del>removed</del>');
    expect(result.html).toContain('<a href="https://example.com">https://example.com</a>');
    expect(result.html).toContain('<aside data-test="raw"><b>trusted</b></aside>');
  });

  it('renders author and date frontmatter as a byline after the first heading', async () => {
    const plugin = cossackPages({ markdownProcessor: processMarkdown });
    const transform = plugin.transform as Function;
    const result = await transform.call(
      { environment: { mode: 'build', name: 'ssr' } },
      `---
title: A post
author: Ada Lovelace
date: 2026-07-26
---
# A post

Post body.
`,
      '/src/pages/blog/a-post.md',
    );

    expect(result.code).toContain('const markdownContent =');
    expect(result.code).toContain('class=\\"mdx-byline');
    expect(result.code).toContain('<time datetime=\\"2026-07-26\\">2026-07-26</time>');
    expect(result.code).toContain('By Ada Lovelace');
    expect(result.code.match(/unsafeHTML\(/g)).toHaveLength(1);
  });

  it('keeps a processor-owned wrapper intact when inserting a byline', async () => {
    const plugin = cossackPages({
      markdownProcessor: async () => ({
        html: '<article><h1>Title</h1><p>Body</p></article>',
        frontmatter: { author: 'Ada & Grace', date: '2026-08-10' },
      }),
    });
    const result = await (plugin.transform as Function).call(
      { environment: { mode: 'build', name: 'ssr' } },
      '# ignored',
      '/src/pages/blog/wrapped.md',
    );

    expect(result.code).toContain(
      '<article><h1>Title</h1><p class=\\"mdx-byline',
    );
    expect(result.code).toContain('By Ada &amp; Grace');
    expect(result.code).toContain('</p><p>Body</p></article>');
    expect(result.code.match(/unsafeHTML\(/g)).toHaveLength(1);
  });

  it('generates a table of contents whose links match heading ids', async () => {
    const { html } = await processMarkdown(`# Guide

## Contents

## First Step

### Details Here
`);

    expect(html).toContain('<h2 id="contents">Contents</h2>');
    expect(html).toContain('href="#first-step"');
    expect(html).toContain('href="#details-here"');
    expect(html).toContain('<h2 id="first-step">First Step</h2>');
    expect(html).toContain('<h3 id="details-here">Details Here</h3>');
  });

  it('highlights code and merges numeric metadata with directives', async () => {
    const { html } = await processMarkdown(`\`\`\`ts {1,5}
const one = 1;
  //   highlight-next-line  
const two = "<tag>";
// highlight-start
const three = true;
const four = false;
// highlight-end
const five = 5;
\`\`\``);

    expect(html).toContain('class="sh-lang--ts"');
    expect(html).toContain('data-sh-language="ts"');
    const renderedLines = html.split('<span class="sh__line').slice(1);
    const highlighted = (text: string) => renderedLines.some(
      line => line.startsWith(' sh__line--highlighted"') && line.includes(`>${text}<`),
    );

    // Numeric metadata addresses the final, visible code lines. Directive
    // comments are authoring controls and do not consume a rendered line.
    expect(highlighted('one')).toBe(true);   // fence metadata {1}
    expect(highlighted('two')).toBe(true);   // highlight-next-line
    expect(highlighted('three')).toBe(true); // highlight-start/end
    expect(highlighted('four')).toBe(true);  // highlight-start/end
    expect(highlighted('five')).toBe(true);  // fence metadata {5}
    expect(renderedLines.filter(line => line.startsWith(' sh__line--highlighted"'))).toHaveLength(5);
    expect(html).toContain('sh__token--keyword');
    expect(html).toContain('&#x3C;tag>');
    expect(html).not.toContain('highlight-next-line');
    expect(html).not.toContain('highlight-start');
    expect(html).not.toContain('highlight-end');
  });

  it('handles malformed directives and unknown languages', async () => {
    const { html } = await processMarkdown(`\`\`\`not-a-real-language
// highlight-end
plain
// highlight-next-line
// highlight-start
rest
continues
\`\`\``);

    expect(html).toContain('sh-lang--not-a-real-language');
    expect(html.match(/sh__line--highlighted/g)).toHaveLength(2);
    expect(html).not.toContain('highlight-');
    expect(html).toContain('plain');
    expect(html).toContain('continues');
  });
});
