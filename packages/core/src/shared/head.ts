export interface HeadTag {
    tag: 'title' | 'meta' | 'link' | 'script' | 'style' | 'base';
    attributes?: Record<string, string | boolean | number>;
    children?: string;
}

export interface HeadContext {
    title: string;
    description: string;
    image: string;
    meta: HeadTag[];
    links: HeadTag[];
    scripts: HeadTag[];
    tags: HeadTag[];
}

export interface HeadValue {
    title?: string;
    description?: string;
    image?: string;
    meta?: HeadTag[];
    links?: HeadTag[];
    scripts?: HeadTag[];
    tags?: HeadTag[];
}

/**
 * Build a HeadContext from an array of existing HeadTags.
 * Extracts title, description, and image shortcuts from well-known meta tags.
 */
export function buildHeadContext(tags: HeadTag[]): HeadContext {
    const context: HeadContext = {
        title: '',
        description: '',
        image: '',
        meta: [],
        links: [],
        scripts: [],
        tags: []
    };

    for (const tag of tags) {
        switch (tag.tag) {
            case 'title':
                context.title = tag.children || '';
                break;
            case 'meta':
                const name = tag.attributes?.name || tag.attributes?.property;
                if (name === 'description' || name === 'og:description') {
                    context.description = String(tag.attributes?.content || '');
                } else if (name === 'og:image' || name === 'twitter:image') {
                    context.image = String(tag.attributes?.content || '');
                }
                context.meta.push(tag);
                break;
            case 'link':
                context.links.push(tag);
                break;
            case 'script':
                context.scripts.push(tag);
                break;
            default:
                context.tags.push(tag);
                break;
        }
    }

    return context;
}

/**
 * Merge a HeadValue into an existing HeadContext and produce a HeadTag array.
 * Auto-expands SEO shortcuts (description, image) into OG/Twitter meta tags.
 */
export function mergeHead(context: HeadContext, value: HeadValue): HeadTag[] {
    const title = value.title ?? context.title;
    const description = value.description ?? context.description;
    const image = value.image ?? context.image;

    let meta = value.meta ?? context.meta;
    const links = value.links ?? context.links;
    const scripts = value.scripts ?? context.scripts;
    const tags = value.tags ?? context.tags;

    const result: HeadTag[] = [];
    if (title) result.push({ tag: 'title', children: title });

    // Auto-expand SEO shortcuts
    if (description) {
        result.push({ tag: 'meta', attributes: { name: 'description', content: description } });
        result.push({ tag: 'meta', attributes: { property: 'og:description', content: description } });
    }
    if (image) {
        result.push({ tag: 'meta', attributes: { property: 'og:image', content: image } });
        result.push({ tag: 'meta', attributes: { name: 'twitter:image', content: image } });
    }

    result.push(...meta);
    result.push(...links);
    result.push(...scripts);
    result.push(...tags);
    return result;
}

/**
 * Apply a list of HeadTags to document.head (client-side only).
 * Replaces all previously managed tags (marked with `data-cossack`).
 */
export function applyHeadTags(tags: HeadTag[]): void {
    const headElement = document.head;

    // Clear existing managed tags
    headElement.querySelectorAll('[data-cossack]').forEach(el => el.remove());

    for (const tag of tags) {
        if (tag.tag === 'title') {
            if (tag.children) document.title = tag.children;
            continue;
        }
        const el = document.createElement(tag.tag);
        el.setAttribute('data-cossack', '');
        if (tag.attributes) {
            for (const [key, value] of Object.entries(tag.attributes)) {
                el.setAttribute(key, String(value));
            }
        }
        if (tag.children) {
            el.textContent = tag.children;
        }
        headElement.appendChild(el);
    }
}
