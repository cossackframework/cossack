export interface HeadTag {
  tag: 'title' | 'script' | 'style' | 'link' | 'meta' | 'base';
  attributes?: Record<string, string | boolean>;
  children?: string;
}
