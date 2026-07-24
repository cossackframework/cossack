import { Cossack, HeadContext, HeadValue, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const posts = [
    { title: 'Hello, world!', description: 'Meet your new Cossack application and its Markdown-powered routes.', href: '/blog/hello-world' },
] as const;

@Page({ transport: 'http' })
export default class BlogPage extends Cossack {
    head(_context: HeadContext): HeadValue { return { title: 'Blog', description: 'Starter posts from your Cossack application.' }; }
    render() {
        return html`<section><h1 class="text-4xl font-bold">${__('Blog')}</h1><div class="mt-8 space-y-4">${posts.map((post) => html`<article class="not-prose rounded-xl border border-border bg-card p-6"><h2 class="text-xl font-semibold"><a href=${post.href} class="hover:underline">${post.title}</a></h2><p class="mt-2 text-muted-foreground">${post.description}</p></article>`)}</div></section>`;
    }
}
