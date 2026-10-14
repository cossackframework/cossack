import { describe, it, expect } from 'vitest';
import { minifyHtml } from './minify-html';

describe('minifyHtml', () => {
    it('collapses multiple whitespace and newlines to single space', () => {
        const input = '<div>   hello   </div>';
        const result = minifyHtml(input);
        expect(result).toBe('<div> hello </div>');
    });

    it('collapses newlines and indentation', () => {
        const input = `<div>
            <span>hello</span>
        </div>`;
        const result = minifyHtml(input);
        expect(result).toBe('<div><span>hello</span></div>');
    });

    it('removes HTML comments', () => {
        const input = '<div><!-- this is a comment -->hello</div>';
        const result = minifyHtml(input);
        expect(result).toBe('<div>hello</div>');
    });

    it('removes multi-line HTML comments', () => {
        const input = `<div>
            <!-- a multi-line
                 comment -->
            <span>hello</span>
        </div>`;
        const result = minifyHtml(input);
        expect(result).toBe('<div><span>hello</span></div>');
    });

    it('preserves Cossack hydration markers (CRP)', () => {
        const input = '<div>Hello <!--CRP_0-->World<!--/CRP--></div>';
        const result = minifyHtml(input);
        expect(result).toBe('<div>Hello <!--CRP_0-->World<!--/CRP--></div>');
    });

    it('still strips non-CRP comments while keeping CRP markers', () => {
        const input = '<div><!-- note --><!--CRP_0-->x<!--/CRP--></div>';
        const result = minifyHtml(input);
        expect(result).toBe('<div><!--CRP_0-->x<!--/CRP--></div>');
    });

    it('preserves Cossack sequence markers (CSA)', () => {
        // CSA markers wrap each list item so the client can adopt lists in
        // place. Stripping them would silently break list hydration.
        const input = '<div><!--CSA-S--><span>a</span><!--CSA-E--><!--CSA-S--><span>b</span><!--CSA-E--></div>';
        const result = minifyHtml(input);
        expect(result).toBe('<div><!--CSA-S--><span>a</span><!--CSA-E--><!--CSA-S--><span>b</span><!--CSA-E--></div>');
    });

    it('keeps CRP and CSA markers while stripping other comments', () => {
        const input = '<div><!--x--><!--CSA-S--><!--CRP_0-->v<!--/CRP--><!--CSA-E--></div>';
        const result = minifyHtml(input);
        expect(result).toBe('<div><!--CSA-S--><!--CRP_0-->v<!--/CRP--><!--CSA-E--></div>');
    });

    it('preserves content inside <script> tags', () => {
        const input = `<div>
            <script>
                const x = 1  +  2;
                if (x > 0) {
                    console.log("hello");
                }
            </script>
        </div>`;
        const result = minifyHtml(input);
        expect(result).toContain('const x = 1  +  2;');
        expect(result).toContain('if (x > 0) {');
    });

    it('preserves content inside <style> tags', () => {
        const input = `<div>
            <style>
                .foo {
                    color: red;
                    background: blue;
                }
            </style>
        </div>`;
        const result = minifyHtml(input);
        expect(result).toContain('.foo {');
        expect(result).toContain('color: red;');
    });

    it('preserves content inside <pre> tags', () => {
        const input = `<div>
            <pre>
Line 1
    Line 2 (indented)
        Line 3 (more indented)
            </pre>
        </div>`;
        const result = minifyHtml(input);
        expect(result).toContain('Line 1\n    Line 2 (indented)\n        Line 3 (more indented)');
    });

    it('preserves content inside <textarea> tags', () => {
        const input = `<form>
            <textarea>
                Hello   World
                Second line
            </textarea>
        </form>`;
        const result = minifyHtml(input);
        expect(result).toContain('Hello   World');
        expect(result).toContain('Second line');
    });

    it('removes type="text/javascript" attributes', () => {
        const input = '<script type="text/javascript">var x = 1;</script>';
        const result = minifyHtml(input);
        expect(result).toBe('<script>var x = 1;</script>');
    });

    it('removes type="text/css" attributes', () => {
        const input = '<style type="text/css">.foo { color: red; }</style>';
        const result = minifyHtml(input);
        expect(result).toBe('<style>.foo { color: red; }</style>');
    });

    it('removes type="text/javascript" with single quotes', () => {
        const input = "<script type='text/javascript'>var x = 1;</script>";
        const result = minifyHtml(input);
        expect(result).toBe('<script>var x = 1;</script>');
    });

    it('removes optional quotes around simple attribute values', () => {
        const input = '<div class="foo" id="bar-baz">hello</div>';
        const result = minifyHtml(input);
        expect(result).toBe('<div class=foo id=bar-baz>hello</div>');
    });

    it('does not merge adjacent malformed SVG attributes when unquoting', () => {
        const input = '<circle cx="12" cy="12" r="6"stroke="currentColor" stroke-width="1.5"/>';
        const result = minifyHtml(input);

        expect(result).toBe('<circle cx=12 cy=12 r=6 stroke=currentColor stroke-width="1.5"/>');
        expect(result).not.toContain('r=6stroke');
    });

    it('keeps quotes around values with special characters', () => {
        const input = '<div class="foo bar">hello</div>';
        // "foo bar" contains a space, so it should stay quoted
        expect(minifyHtml(input)).toContain('"foo bar"');
    });

    it('collapses self-closing void elements', () => {
        const input = '<img src="test.png" />';
        const result = minifyHtml(input);
        expect(result).toBe('<img src=test.png>');
    });

    it('collapses self-closing on void elements with multiple attributes', () => {
        const input = '<input type="text" name="foo" />';
        const result = minifyHtml(input);
        expect(result).toBe('<input type=text name=foo>');
    });

    it('does not collapse self-closing on non-void elements', () => {
        const input = '<div />';
        const result = minifyHtml(input);
        // div is not a void element, so the slash stays (it matters in SVG)
        expect(result).toBe('<div/>');
    });

    it('preserves sibling SVG elements whose final attribute precedes a self-closing slash', () => {
        const input = `<svg xmlns="http://www.w3.org/2000/svg">
            <circle cx="11.5" cy="11.5" r="9.5"stroke="currentColor" stroke-width="1.5"/>
            <path d="M18.5 18.5L22 22"stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
        const result = minifyHtml(input);

        expect(result).toContain('stroke-width="1.5"/>');
        expect(result).toContain('stroke-linecap="round"/>');

        document.body.innerHTML = result;
        const svg = document.body.querySelector('svg')!;
        const circle = svg.querySelector('circle')!;
        const path = svg.querySelector('path')!;

        expect(svg.children).toHaveLength(2);
        expect(circle.children).toHaveLength(0);
        expect(circle.getAttribute('stroke-width')).toBe('1.5');
        expect(path.parentElement).toBe(svg);
        expect(path.getAttribute('stroke-linecap')).toBe('round');
    });

    it('trims leading and trailing whitespace', () => {
        const input = '   <div>hello</div>   ';
        const result = minifyHtml(input);
        expect(result).toBe('<div>hello</div>');
    });

    it('returns input unchanged when already minified', () => {
        const input = '<div><span>hello</span></div>';
        const result = minifyHtml(input);
        expect(result).toBe('<div><span>hello</span></div>');
    });

    it('handles a full HTML document', () => {
        const input = `<!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                <title>Test</title>
                <!-- a comment -->
                <link rel="stylesheet" href="style.css">
                <script type="module" src="app.js"></script>
            </head>
            <body>
                <div id="root">
                    <h1>Hello World</h1>
                    <img src="hero.png" alt="Hero image" />
                </div>
            </body>
        </html>`;
        const result = minifyHtml(input);
        expect(result).not.toContain('<!--');
        expect(result).not.toContain('type="text/javascript"');
        expect(result).toContain('<img src=hero.png');
        expect(result).toContain('<!DOCTYPE html>');
        expect(result).toContain('<h1>Hello World</h1>');
        // No extra whitespace between tags
        expect(result).not.toMatch(/>\s+</);
    });

    it('preserves multiple preserve-tag blocks', () => {
        const input = `<div>
            <style>.red { color: red; }</style>
            <p>text</p>
            <script>var x = 1;</script>
        </div>`;
        const result = minifyHtml(input);
        expect(result).toContain('.red { color: red; }');
        expect(result).toContain('var x = 1;');
    });
});

it('preserves whitespace-only textarea values and text that resembles attributes', () => {
    expect(minifyHtml('<div> </div> <textarea> \n\t </textarea> <p>After</p>'))
        .toBe('<div></div><textarea> \n\t </textarea><p>After</p>');
    expect(minifyHtml('<textarea>Keep type="text/javascript" as text</textarea>'))
        .toBe('<textarea>Keep type="text/javascript" as text</textarea>');
});

// minifyHtml reads markup with the renderer's shared tokenizer, so it agrees
// with the browser on text, attribute values, comments and raw-text elements.
describe('minifyHtml tokenization', () => {
    it('never rewrites text that resembles attributes', () => {
        expect(minifyHtml('<p>Set debug="true" and  type="text/css" here</p>'))
            .toBe('<p>Set debug="true" and type="text/css" here</p>');
    });

    it('keeps `<` in text as text', () => {
        expect(minifyHtml('<p>if a < b then c="d" </p>')).toBe('<p>if a < b then c="d" </p>');
        expect(minifyHtml('<p>1 <2</p><a href="/x">x</a>')).toBe('<p>1 <2</p><a href="/x">x</a>');
    });

    it('keeps comment-like text inside raw-text elements and attribute values', () => {
        expect(minifyHtml('<title>a <!-- b --> c</title>')).toBe('<title>a <!-- b --> c</title>');
        expect(minifyHtml('<div title="<!-- x -->">y</div>')).toBe('<div title="<!-- x -->">y</div>');
        expect(minifyHtml('<script>if (a <!--b) x("-->")</script>')).toBe('<script>if (a <!--b) x("-->")</script>');
    });

    it('keeps raw-text content whose opening tag has `>` in an attribute value', () => {
        expect(minifyHtml('<script data-x="a>b">x  =  1</script>')).toBe('<script data-x="a>b">x  =  1</script>');
    });

    it('keeps attribute values byte for byte, except class whitespace', () => {
        expect(minifyHtml('<input value="a  b" title="line\n  two" class="  a\n   b ">'))
            .toBe('<input value="a  b" title="line\n  two" class="a b">');
    });

    it('treats a no-break space as content', () => {
        expect(minifyHtml('<p>a\u00a0\u00a0b</p> <p>\u00a0</p>')).toBe('<p>a\u00a0\u00a0b</p><p>\u00a0</p>');
    });

    it('keeps whitespace inside <pre>, including around nested elements', () => {
        expect(minifyHtml('<pre>  <b>x</b>   y\n  z</pre>  <p>q</p>')).toBe('<pre>  <b>x</b>   y\n  z</pre><p>q</p>');
    });

    it('quotes an unquoted value that a self-closing slash follows', () => {
        expect(minifyHtml('<path d=M0 />')).toBe('<path d="M0"/>');
        expect(minifyHtml(`<path d=a"b' />`)).toBe(`<path d="a&quot;b'"/>`);
        expect(minifyHtml('<a href=/x/ id=a>')).toBe('<a href=/x/ id=a>');
    });

    it('keeps a comment whose removal would create markup or complete an entity', () => {
        expect(minifyHtml('<p>a <<!-- c -->b</p>')).toBe('<p>a <<!-- c -->b</p>');
        expect(minifyHtml('<p>&am<!-- c -->p;</p>')).toBe('<p>&am<!-- c -->p;</p>');
        expect(minifyHtml('<p>a <!-- c --> b</p>')).toBe('<p>a b</p>');
    });

    it('produces markup that parses to the same elements', () => {
        const input = `<!DOCTYPE html><html><head><title>A &amp; B <!-- x --></title></head>
            <body><p title='1 < 2' class="a
                b">x = "y" <b>z</b></p><svg><path d="M0 0"/><circle r="6"stroke="red"/></svg></body></html>`;
        const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
        const original = parse(input);
        const minified = parse(minifyHtml(input));
        expect(minified.title).toBe(original.title);
        expect(minified.querySelector('p')!.getAttribute('title')).toBe('1 < 2');
        expect(minified.querySelector('p')!.className).toBe('a b');
        expect(minified.querySelector('p')!.textContent).toBe('x = "y" z');
        expect(minified.querySelector('svg')!.children.length).toBe(2);
        expect(minified.querySelector('circle')!.getAttribute('stroke')).toBe('red');
    });
});
