import { Cossack, Page } from '@cossackframework/core';
import { Breadcrumb, type BreadcrumbItem } from '@cossackframework/ui';
import { component, html } from '@cossackframework/renderer';

function breadcrumbFor(pathname: string): { postTitle: string; items: BreadcrumbItem[] } {
    const slug = pathname.replace(/\/+$/, '').replace(/^\/blog\/?/, '');
    const postSlug = slug.split('/').at(-1) ?? '';
    const postTitle = postSlug
        ? postSlug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
        : '';
    return {
        postTitle,
        items: [
            { value: 'home', label: __('Home'), href: '/' },
            postTitle ? { value: 'blog', label: __('Blog'), href: '/blog' } : { value: 'blog', label: __('Blog') },
            ...(postTitle ? [{ value: `post:${slug}`, label: postTitle }] : []),
        ],
    };
}

@Page({ transport: 'http' })
export default class BlogLayout extends Cossack {
    render() {
        // Persistent layouts are re-rendered after SPA navigation and Cossack
        // updates their hydrated request path before composing the new page.
        const breadcrumb = breadcrumbFor(this.c.req.path);
        return html`
            <div class="mx-auto max-w-3xl px-4 py-12 sm:py-16">
                <div class="mb-8">
                    ${component(Breadcrumb, { label: __('Breadcrumb'), items: breadcrumb.items })}
                </div>
                <article class="max-w-none text-foreground [&_h1]:mb-6 [&_h1]:text-4xl [&_h1]:font-bold [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_p]:my-5 [&_p]:leading-7 [&_p]:text-muted-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5">
                    ${this.children}
                </article>
            </div>
        `;
    }
}
