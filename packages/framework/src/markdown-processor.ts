import { unified, type Plugin } from 'unified';
import type { Root } from 'mdast';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkToc from 'remark-toc';
import remarkRehype from 'remark-rehype';
import remarkSugarHigh from 'remark-sugar-high';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { matter } from 'vfile-matter';
import { validateMarkdownFrontmatter, MarkdownFrontmatterError, type MarkdownFrontmatter, type MarkdownFrontmatterOptions, type MarkdownFrontmatterExtensions } from './markdown-frontmatter.js';
export * from './markdown-frontmatter.js';

export interface MarkdownResult<Extensions extends object = Record<never, never>> {
  html: string;
  frontmatter: MarkdownFrontmatter<Extensions>;
}

interface MarkdownNode {
  type?: string;
  value?: string;
  meta?: string | null;
  children?: MarkdownNode[];
}

const directivePattern = /^\s*\/\/\s*highlight-(next-line|start|end)\s*$/;
const numericHighlightPattern = /\{([\d,\s-]+)\}/;

function numericHighlightLines(meta: string | null | undefined): Set<number> {
  const lines = new Set<number>();
  const match = meta?.match(numericHighlightPattern);
  if (!match) return lines;

  for (const item of match[1].split(',')) {
    const range = item.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!range) continue;
    const start = Number(range[1]);
    const end = Number(range[2] ?? range[1]);
    for (let line = start; line <= end; line++) lines.add(line);
  }
  return lines;
}

/** Remove Docusaurus-style directives and convert them to Sugar High metadata. */
export const remarkHighlightDirectives: Plugin<[], Root> = () => {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === 'code' && typeof node.value === 'string') {
        const highlighted = numericHighlightLines(node.meta);
        const output: string[] = [];
        let highlightNext = false;
        let highlightRange = false;

        for (const line of node.value.split('\n')) {
          const directive = line.match(directivePattern)?.[1];
          if (directive === 'next-line') {
            highlightNext = true;
            continue;
          }
          if (directive === 'start') {
            highlightRange = true;
            continue;
          }
          if (directive === 'end') {
            highlightRange = false;
            continue;
          }

          output.push(line);
          if (highlightRange || highlightNext) highlighted.add(output.length);
          highlightNext = false;
        }

        node.value = output.join('\n');
        const otherMeta = (node.meta ?? '').replace(numericHighlightPattern, '').trim();
        const rangeMeta = highlighted.size > 0
          ? `{${[...highlighted].sort((a, b) => a - b).join(',')}}`
          : '';
        node.meta = [otherMeta, rangeMeta].filter(Boolean).join(' ') || null;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
};

const parseFrontmatter: Plugin<[MarkdownFrontmatterOptions<any>], Root> = (options) =>
  (_tree, file) => {
    try { matter(file); } catch {
      throw new MarkdownFrontmatterError([{ code: 'COSSACK_MARKDOWN_FRONTMATTER_INVALID', field: '<metadata>',
        source: { file: options.filename ?? '<markdown>', line: 1, column: 1 }, expected: 'valid YAML metadata' }]);
    }
    file.data.matter = validateMarkdownFrontmatter(file.data.matter ?? {}, options);
  };

// remark-sugar-high's bundled declaration exposes an untyped tree transformer;
// this adapter preserves unified's mdast input type without a call-site cast.
const sugarHigh: Plugin<[], Root> = () => remarkSugarHigh();

/** Build-time Markdown-to-HTML pipeline used by the Vite pages plugin. */
export async function processMarkdown(source: string, filename?: string): Promise<MarkdownResult> {
  return processWithOptions(source, { filename });
}

export interface ConfiguredMarkdownProcessor<Extensions extends object> {
  (source: string, filename?: string): Promise<MarkdownResult<Extensions>>;
  readonly frontmatterExtensions: MarkdownFrontmatterExtensions<Extensions>;
}

/** Create one reusable processor with explicitly validated application metadata. */
export function createMarkdownProcessor<Extensions extends object>(options: Omit<MarkdownFrontmatterOptions<Extensions>, 'source' | 'filename'>): ConfiguredMarkdownProcessor<Extensions> {
  const extensions = Object.freeze(options.extensions ?? {}) as MarkdownFrontmatterExtensions<Extensions>;
  const processor = (source: string, filename?: string): Promise<MarkdownResult<Extensions>> => processWithOptions(source, { ...options, extensions, filename });
  Object.defineProperty(processor, 'frontmatterExtensions', { value: extensions, enumerable: true });
  return processor as ConfiguredMarkdownProcessor<Extensions>;
}

async function processWithOptions<Extensions extends object = Record<never, never>>(source: string, options: MarkdownFrontmatterOptions<Extensions>): Promise<MarkdownResult<Extensions>> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(parseFrontmatter, { ...options, source })
    .use(remarkGfm)
    .use(remarkToc)
    .use(remarkHighlightDirectives)
    .use(sugarHigh)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeStringify)
    .process(source);

  return {
    html: String(file),
    frontmatter: file.data.matter as MarkdownFrontmatter<Extensions>,
  };
}
