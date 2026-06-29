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
        // div is not a void element, so it should remain unchanged (besides whitespace)
        expect(result).toContain('<div />');
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
