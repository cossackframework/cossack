export interface HeadTag {
  tag: 'title' | 'script' | 'style' | 'link' | 'meta' | 'base';
  attributes?: Record<string, string | boolean>;
  children?: string;
}

export interface HeadContext {
  title: string;
  meta: HeadTag[];
  links: HeadTag[];
  scripts: HeadTag[];
  tags: HeadTag[];
}

export interface HeadValue {
  title?: string;
  meta?: HeadTag[];
  links?: HeadTag[];
  scripts?: HeadTag[];
  tags?: HeadTag[];
}
