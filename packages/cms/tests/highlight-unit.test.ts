import { describe, expect, it } from 'vitest';
import { highlightCode, highlightLanguage, HIGHLIGHT_LANGUAGES } from '../src/highlight';

describe('code highlighting', () => {
    it('knows the common languages and leaves others as written', () => {
        expect(highlightLanguage('TS')).toBe('ts');
        expect(highlightLanguage('brainfuck')).toBe('');
        expect(HIGHLIGHT_LANGUAGES).toContain('bash');
        expect(highlightCode('<b>x</b> & y', 'brainfuck')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y');
    });

    it('marks comments, strings, numbers, keywords, types and calls in C-like code', () => {
        const html = highlightCode('const n: number = 42; // answer\nreturn greet("Ada");', 'ts');
        expect(html).toContain('<span class="tok-k">const</span>');
        expect(html).toContain('<span class="tok-t">number</span>');
        expect(html).toContain('<span class="tok-n">42</span>');
        expect(html).toContain('<span class="tok-c">// answer</span>');
        expect(html).toContain('<span class="tok-f">greet</span>');
        expect(html).toContain('<span class="tok-s">&quot;Ada&quot;</span>');
        expect(html).not.toContain('<span class="tok-k">greet');
    });

    it('reads markup, shell, JSON and diff', () => {
        expect(highlightCode('<a href="/x">hi</a><!-- c -->', 'html')).toBe('&lt;<span class="tok-g">a</span> <span class="tok-a">href</span>=<span class="tok-s">&quot;/x&quot;</span>&gt;hi&lt;/<span class="tok-g">a</span>&gt;<span class="tok-c">&lt;!-- c --&gt;</span>');
        expect(highlightCode('pnpm add --save-dev vitest # dev', 'bash')).toContain('<span class="tok-f">pnpm</span>');
        expect(highlightCode('pnpm add --save-dev vitest # dev', 'bash')).toContain('<span class="tok-c"># dev</span>');
        expect(highlightCode('{"name": "x", "ok": true}', 'json')).toContain('<span class="tok-a">&quot;name&quot;</span>');
        expect(highlightCode('{"name": "x", "ok": true}', 'json')).toContain('<span class="tok-k">true</span>');
        expect(highlightCode('-old\n+new', 'diff')).toBe('<span class="tok-d">-old</span>\n<span class="tok-i">+new</span>');
    });

    it('escapes everything it does not mark', () => {
        const html = highlightCode('if (a < b && c > d) { x = "<script>" }', 'js');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });
});
