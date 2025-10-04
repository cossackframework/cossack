import { Part, PartType, TemplateResult } from '../types';
import { render } from './render';

export class ChildPart implements Part {
  private start: Comment;
  private end: Comment;

  constructor(start: Comment, end: Comment) {
    this.start = start;
    this.end = end;
  }

  commit(value: unknown) {
    const parent = this.start.parentNode!;
    let current = this.start.nextSibling;
    while (current !== this.end) {
      const next = current!.nextSibling;
      parent.removeChild(current!);
      current = next;
    }

    const nodes = this.toNodes(value);
    for (const node of nodes) {
      parent.insertBefore(node, this.end);
    }
  }

  private toNodes(value: unknown): Node[] {
    if (value instanceof TemplateResult) {
      const frag = document.createDocumentFragment();
      render(value, frag);
      return Array.from(frag.childNodes);
    } else if (Array.isArray(value)) {
      return value.flatMap((v) => this.toNodes(v));
    } else {
      const node = this.toNode(value);
      return [node];
    }
  }

  private toNode(value: unknown): Node {
    if (value instanceof Node) {
      return value;
    }
    return document.createTextNode(String(value));
  }
}

export class AttributePart implements Part {
  constructor(
    public element: Element,
    public name: string,
    public type: PartType
  ) {}

  commit(value: unknown) {
    switch (this.type) {
      case 'attribute':
        if (value == null) {
          this.element.removeAttribute(this.name);
        } else {
          this.element.setAttribute(this.name, String(value));
        }
        break;
      case 'boolean':
        if (value) {
          this.element.setAttribute(this.name, '');
        } else {
          this.element.removeAttribute(this.name);
        }
        break;
      case 'property':
        (this.element as any)[this.name] = value;
        break;
      case 'event':
        (this.element as any)[`on${this.name}`] = value;
        break;
    }
  }
}

export class SpreadPart implements Part {
  private _previousProps: Record<string, unknown> = {};
  constructor(public element: Element) {}

  commit(value: unknown) {
    const props = (value as Record<string, unknown>) || {};

    const oldProps = this._previousProps;
    this._previousProps = { ...props }; // Make a copy

    // Remove old properties that are not in new properties
    for (const name in oldProps) {
      if (!(name in props)) {
        if (name.startsWith('@')) {
          (this.element as any)[`on${name.slice(1)}`] = null;
        } else if (name.startsWith('?')) {
          this.element.removeAttribute(name.slice(1));
        } else if (name.startsWith('.')) {
          (this.element as any)[name.slice(1)] = undefined;
        } else {
          this.element.removeAttribute(name);
        }
      }
    }

    // Set new and updated properties
    for (const name in props) {
      const propValue = props[name];
      // Only update if changed
      if (oldProps[name] !== propValue) {
        if (name.startsWith('@')) {
          // event
          (this.element as any)[`on${name.slice(1)}`] = propValue;
        } else if (name.startsWith('?')) {
          // boolean
          const attrName = name.slice(1);
          if (propValue) {
            this.element.setAttribute(attrName, '');
          } else {
            this.element.removeAttribute(attrName);
          }
        } else if (name.startsWith('.')) {
          // property
          (this.element as any)[name.slice(1)] = propValue;
        } else {
          // attribute
          if (typeof name === 'string' && /^[a-zA-Z0-9-_:]+$/.test(name)) {
            if (propValue == null) {
              this.element.removeAttribute(name);
            } else {
              this.element.setAttribute(name, String(propValue));
            }
          }
        }
      }
    }
  }
}