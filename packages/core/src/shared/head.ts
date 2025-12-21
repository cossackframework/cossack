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
