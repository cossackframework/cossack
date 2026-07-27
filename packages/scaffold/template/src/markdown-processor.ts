import type { MarkdownResult } from '@cossackframework/framework/vite-plugin';
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

/** Convert code-fence highlight directives to Sugar High line metadata. */
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

const parseFrontmatter: Plugin<[], Root> = () =>
  (_tree, file) => matter(file);

const sugarHigh: Plugin<[], Root> = () => remarkSugarHigh();

/** Application-owned build-time Markdown-to-HTML pipeline. */
export async function processMarkdown(source: string): Promise<MarkdownResult> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(parseFrontmatter)
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
    frontmatter: (file.data.matter ?? {}) as Record<string, unknown>,
  };
}
