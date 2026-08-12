import { describe, it, expect } from 'vitest';
import { html, renderToString } from './cossack-html';
import { live } from './directives';

describe('SSR Fixes & Regressions', () => {
    
    it('suppresses events (@event) cleanly without extra spaces or quotes', () => {
        const template = html`<button @click=${() => {}} class="btn">Click</button>`;
        expect(renderToString(template)).toBe('<button class="btn">Click</button>');
        
        const template2 = html`<button @click="${() => {}}">Click</button>`;
        expect(renderToString(template2)).toBe('<button>Click</button>');
    });

    it('suppresses boolean attributes (?attr) cleanly', () => {
        const template = html`<button ?disabled=${false}>Click</button>`;
        expect(renderToString(template)).toBe('<button>Click</button>');
        
        const template2 = html`<button ?disabled="${false}">Click</button>`;
        expect(renderToString(template2)).toBe('<button>Click</button>');
        
        const template3 = html`<button ?disabled=${true}>Click</button>`;
        expect(renderToString(template3)).toBe('<button disabled>Click</button>');
    });

    it('handles property binding (.prop) with directives (live)', () => {
        const template = html`<input .value=${live("test")}>`;
        expect(renderToString(template)).toBe('<input value="test">');
        
        const template2 = html`<input .value="${live("test")}">`;
        expect(renderToString(template2)).toBe('<input value="test">');
    });

    it('handles property binding (.prop) with null/undefined cleanly', () => {
        const template = html`<input .value=${null}>`;
        expect(renderToString(template)).toBe('<input>');
        
        const template2 = html`<input .value="${undefined}">`;
        expect(renderToString(template2)).toBe('<input>');
    });

    it('handles mixed attributes with correct spacing', () => {
        const template = html`<div id="1" @click=${() => {}} class="foo"></div>`;
        expect(renderToString(template)).toBe('<div id="1" class="foo"></div>');
        
        // Test adjacent suppressions
        const template2 = html`<div @click=${1} ?hidden=${false} id="2"></div>`;
        expect(renderToString(template2)).toBe('<div id="2"></div>');
    });

    it('handles quotes correctly in attribute replacement', () => {
        // This was the bug where it produced value="""
        const template = html`<input .value="${""}" />`;
        expect(renderToString(template)).toBe('<input value="" />');
        
        const template2 = html`<input .value="${live("")}" />`;
        expect(renderToString(template2)).toBe('<input value="" />');
    });

    it('serializes ARIA booleans as explicit true/false strings', () => {
        expect(renderToString(html`<button aria-pressed=${true}></button>`))
            .toBe('<button aria-pressed="true"></button>');
        expect(renderToString(html`<button aria-pressed=${false}></button>`))
            .toBe('<button aria-pressed="false"></button>');
    });

    it('uses presence semantics only for native boolean attributes', () => {
        expect(renderToString(html`<button disabled=${true}></button>`))
            .toBe('<button disabled></button>');
        expect(renderToString(html`<button disabled=${false}></button>`))
            .toBe('<button></button>');
        expect(renderToString(html`<div data-active=${false}></div>`))
            .toBe('<div data-active="false"></div>');
        expect(renderToString(html`<div title=${undefined}></div>`))
            .toBe('<div></div>');
    });

    it('applies the same boolean rules to spread attributes', () => {
        const output = renderToString(html`<input ...=${{
            disabled: false,
            'aria-checked': false,
            'data-ready': true,
        }}>`);
        expect(output).toBe('<input aria-checked="false" data-ready="true">');
    });

    it('recognizes unsafe HTML created by another renderer module instance', () => {
        const foreignUnsafeHtml = {
            value: '<svg data-foreign="true"></svg>',
            [Symbol.for('@cossackframework/renderer/unsafe-html')]: true,
        };
        expect(renderToString(html`<span>${foreignUnsafeHtml}</span>`))
            .toBe('<span><svg data-foreign="true"></svg></span>');
    });

    it('keeps attribute-like text interpolations as hydratable node parts', () => {
        expect(renderToString(html`<code>style="${'line'}"</code>`, { hydrate: true }))
            .toBe('<code>style="<!--CRP_0-->line<!--/CRP-->"</code>');
    });
});
