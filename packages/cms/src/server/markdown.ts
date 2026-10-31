/**
 * Markdown for post and page bodies, rendered on the server. Raw HTML is escaped rather
 * than passed through, and links and images use markdown-it's safe URL check, so stored
 * content cannot inject script into the public site.
 */
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });

/** HTML for a Markdown body. */
export function renderMarkdown(text: string): string {
    return markdown.render(typeof text === 'string' ? text : '');
}

/** Plain text of a Markdown body, cut at a word boundary after `words` words. */
export function excerptOf(text: string, words = 55): string {
    const parts: string[] = [];
    for (const token of markdown.parse(typeof text === 'string' ? text : '', {})) {
        if (token.type !== 'inline') continue;
        parts.push((token.children ?? []).filter(child => child.type === 'text' || child.type === 'code_inline').map(child => child.content).join(''));
    }
    const all = parts.join(' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    return all.length > words ? `${all.slice(0, words).join(' ')}…` : all.join(' ');
}
