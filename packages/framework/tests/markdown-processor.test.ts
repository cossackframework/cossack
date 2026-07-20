import { describe, expect, it } from 'vitest';
import { processMarkdown } from '../src/markdown-processor';

describe('Markdown processor', () => {
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
