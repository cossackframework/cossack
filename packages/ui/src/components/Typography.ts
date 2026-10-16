import type { GlobalAttributes, QuoteAttributes, OrderedListAttributes } from "../native-attributes";
import { html, IfDefinedResult } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

type TextAttributes<Element extends HTMLElement> = GlobalAttributes<Element> & {
    cite?: never; start?: never; reversed?: never; '?reversed'?: never; type?: never;
};
/** Each variant owns its actual native element and event target. */
export type TypographyProps =
    | (TextAttributes<HTMLParagraphElement> & { variant?: 'p' | 'lead' | 'muted' })
    | (TextAttributes<HTMLHeadingElement> & { variant: 'h1' | 'h2' | 'h3' | 'h4' })
    | (QuoteAttributes & { variant: 'blockquote'; start?: never; reversed?: never; '?reversed'?: never; type?: never })
    | (OrderedListAttributes & { variant: 'ol'; cite?: never })
    | (TextAttributes<HTMLUListElement> & { variant: 'ul' })
    | (TextAttributes<HTMLElement> & { variant: 'code' | 'kbd' | 'small' });

const STYLES: Record<NonNullable<TypographyProps["variant"]>, string> = {
    h1: "scroll-m-20 text-4xl font-extrabold tracking-tight text-foreground lg:text-5xl",
    h2: "scroll-m-20 border-b border-border pb-2 text-3xl font-semibold tracking-tight text-foreground first:mt-0",
    h3: "scroll-m-20 text-2xl font-semibold tracking-tight text-foreground",
    h4: "scroll-m-20 text-xl font-semibold tracking-tight text-foreground",
    p: "leading-7 text-foreground [&:not(:first-child)]:mt-4",
    lead: "text-xl text-muted-foreground",
    small: "text-sm font-medium leading-none text-foreground",
    muted: "text-sm text-muted-foreground",
    blockquote: "mt-6 border-l-2 border-border pl-6 italic text-muted-foreground",
    code: "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-medium text-foreground",
    kbd: "inline-flex items-center justify-center rounded border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground shadow-xs",
    ul: "my-6 ml-6 list-disc [&>li]:mt-2 text-foreground",
    ol: "my-6 ml-6 [&>li]:mt-2 text-foreground",
};

const LIST_STYLES: Record<string, string> = {
    '1': 'list-decimal', a: 'list-[lower-alpha]', A: 'list-[upper-alpha]',
    i: 'list-[lower-roman]', I: 'list-[upper-roman]',
};

const TAGS: Record<NonNullable<TypographyProps["variant"]>, string> = {
    h1: "h1",
    h2: "h2",
    h3: "h3",
    h4: "h4",
    p: "p",
    lead: "p",
    small: "small",
    muted: "p",
    blockquote: "blockquote",
    code: "code",
    kbd: "kbd",
    ul: "ul",
    ol: "ol",
};

/**
 * Cossack UI Typography — typographic primitives with opinionated styles.
 *
 * Renders the appropriate semantic HTML element (h1…h4, p, blockquote, code,
 * ul, ol) with shadcn-inspired typographic defaults.
 *
 *   <${Typography} variant="h1">Page title</${Typography}>
 *   <${Typography} variant="lead">A short, friendly intro.</${Typography}>
 *   <${Typography} variant="blockquote">A quote.</${Typography}>
 */
@Component()
export class Typography extends Cossack {
    declare props: TypographyProps;

    render() {
        const { variant = "p", ...rest } = this.props;
        if (!Object.hasOwn(STYLES, variant)) throw new Error('Typography requires a supported variant.');
        const tag = TAGS[variant];
        const rawListType = 'type' in rest ? rest.type : undefined;
        const listType = rawListType instanceof IfDefinedResult ? rawListType.value : rawListType;
        const listStyle = typeof listType === 'string' && Object.hasOwn(LIST_STYLES, listType) ? LIST_STYLES[listType] : LIST_STYLES['1'];
        const cls = STYLES[variant] + (variant === 'ol' ? ` ${listStyle}` : '');

        // Static templates preserve each native tag through SSR and hydration.
        switch (tag) {
            case "h1":
                return html`<h1 class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</h1>`;
            case "h2":
                return html`<h2 class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</h2>`;
            case "h3":
                return html`<h3 class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</h3>`;
            case "h4":
                return html`<h4 class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</h4>`;
            case "blockquote":
                return html`<blockquote class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</blockquote>`;
            case "code":
                return html`<code class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</code>`;
            case "kbd":
                return html`<kbd class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</kbd>`;
            case "small":
                return html`<small class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</small>`;
            case "ul":
                return html`<ul class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</ul>`;
            case "ol":
                return html`<ol class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</ol>`;
            default:
                return html`<p class=${`cs-typography cs-typography--${variant} ${cls}`} ...=${rest}>${this.children}</p>`;
        }
    }
}
