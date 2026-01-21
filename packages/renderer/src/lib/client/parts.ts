import { Part, PartType, TemplateResult } from '../types';

const MARKER = '{{__C__}}';

const isTemplateResult = (value: any): value is TemplateResult => {
  return value && typeof value === 'object' && 'strings' in value && 'values' in value;
}

const templateCache = new WeakMap<TemplateStringsArray, Template>();

export class Template {
  element: HTMLTemplateElement;
  strings: TemplateStringsArray;

  constructor(strings: TemplateStringsArray) {
    this.strings = strings;
    const html = strings.join(MARKER);
    this.element = document.createElement('template');
    this.element.innerHTML = html;
  }
}

export function getTemplate(strings: TemplateStringsArray): Template {
  let template = templateCache.get(strings);
  if (template === undefined) {
    template = new Template(strings);
    templateCache.set(strings, template);
  }
  return template;
}

export class TemplateInstance {
  _parts: Part[] = [];
  _values: unknown[] = [];
  
  constructor(public template: Template) {}

  clone(): DocumentFragment {
    const fragment = this.template.element.content.cloneNode(true) as DocumentFragment;
    this._parts = createParts(fragment);
    return fragment;
  }

  update(values: readonly unknown[]) {
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== this._values[i]) {
        this._parts[i].commit(values[i]);
        this._values[i] = values[i];
      }
    }
  }
}

export class ChildPart implements Part {
  private start: Comment;
  private end: Comment;
  private _templateInstance?: TemplateInstance;
  private _parts?: ChildPart[]; // For array values
  private _value: unknown;

  constructor(start: Comment, end: Comment) {
    this.start = start;
    this.end = end;
  }

  commit(value: unknown) {
    if (value === this._value) return;

    if (isTemplateResult(value)) {
        this.handleTemplateResult(value);
    } else if (Array.isArray(value)) {
        this.handleArray(value);
    } else {
        this.handleText(value);
    }

    this._value = value;
  }

  private handleTemplateResult(result: TemplateResult) {
    // Clear previous non-template state
    if (this._parts) {
        this.clear();
        this._parts = undefined;
    }

    if (this._templateInstance && this._templateInstance.template.strings === result.strings) {
        this._templateInstance.update(result.values);
        return;
    }
    
    this.clear();
    this._templateInstance = new TemplateInstance(getTemplate(result.strings));
    const fragment = this._templateInstance.clone();
    this._templateInstance.update(result.values);
    this.start.parentNode!.insertBefore(fragment, this.end);
  }

  private handleArray(items: unknown[]) {
    // Clear previous single-template or text state
    if (this._templateInstance || (this._value !== undefined && !Array.isArray(this._value))) {
        this.clear();
        this._templateInstance = undefined;
    }

    const parent = this.start.parentNode!;
    const oldParts = this._parts || [];
    const newParts: ChildPart[] = [];

    // Reconcile parts
    for (let i = 0; i < items.length; i++) {
        let part = oldParts[i];
        if (!part) {
            const s = document.createComment('');
            const e = document.createComment('');
            parent.insertBefore(s, this.end);
            parent.insertBefore(e, this.end);
            part = new ChildPart(s, e);
        }
        part.commit(items[i]);
        newParts.push(part);
    }

    // Cleanup extra parts
    for (let i = items.length; i < oldParts.length; i++) {
        const part = oldParts[i];
        part.clear();
        parent.removeChild(part.start);
        parent.removeChild(part.end);
    }

    this._parts = newParts;
  }

  private handleText(value: unknown) {
    // Clear previous complex state
    if (this._templateInstance || this._parts) {
        this.clear();
        this._templateInstance = undefined;
        this._parts = undefined;
    }

    this.clear();
    const node = this.toNode(value);
    this.start.parentNode!.insertBefore(node, this.end);
  }

  clear() {
    const parent = this.start.parentNode!;
    let current = this.start.nextSibling;
    while (current && current !== this.end) {
      const next = current.nextSibling;
      parent.removeChild(current);
      current = next;
    }
  }

  private toNode(value: unknown): Node {
    if (value instanceof Node) {
      return value;
    }
    // Handle null/undefined as empty string to clear text
    return document.createTextNode(value == null ? '' : String(value));
  }
}

export class AttributePart implements Part {
  private _listener: any;
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
        if (this._listener) {
            this.element.removeEventListener(this.name, this._listener);
        }
        if (value) {
            this.element.addEventListener(this.name, value as EventListener);
            this._listener = value;
        }
        break;
      case 'ref':
        if (typeof value === 'function') {
          value(this.element);
        } else if (value && typeof value === 'object' && 'value' in value) {
          (value as any).value = this.element;
        }
        break;
    }
  }
}

export class AttributeCommitter {
  public values: unknown[];

  constructor(
    public element: Element,
    public name: string,
    public strings: string[]
  ) {
    this.values = Array.from({ length: strings.length - 1 }).fill('');
  }

  commit(index: number, value: unknown) {
    this.values[index] = value;
    this.render();
  }

  render() {
    let result = this.strings[0];
    for (let i = 0; i < this.values.length; i++) {
      const v = this.values[i];
      result += (v === null || v === undefined ? '' : String(v)) + this.strings[i + 1];
    }
    this.element.setAttribute(this.name, result);
  }
}

export class MultiAttributePart implements Part {
  constructor(public committer: AttributeCommitter, public index: number) {}

  commit(value: unknown) {
    this.committer.commit(this.index, value);
  }
}

export class SpreadPart implements Part {
  private _previousProps: Record<string, unknown> = {};
  private _listeners: Record<string, any> = {};
  constructor(public element: Element) {}

  commit(value: unknown) {
    const props = (value as Record<string, unknown>) || {};

    const oldProps = this._previousProps;
    this._previousProps = { ...props }; // Make a copy

    // Remove old properties that are not in new properties
    for (const name in oldProps) {
      if (!(name in props)) {
        if (name.startsWith('@')) {
          const eventName = name.slice(1);
          if (this._listeners[eventName]) {
              this.element.removeEventListener(eventName, this._listeners[eventName]);
              delete this._listeners[eventName];
          }
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
          const eventName = name.slice(1);
          if (this._listeners[eventName]) {
              this.element.removeEventListener(eventName, this._listeners[eventName]);
          }
          if (propValue) {
              this.element.addEventListener(eventName, propValue as EventListener);
              this._listeners[eventName] = propValue;
          } else {
              delete this._listeners[eventName];
          }
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

export function createParts(container: Element | DocumentFragment): Part[] {
  const parts: Part[] = [];
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  );
  const nodesToReplace = new Map<Text, DocumentFragment>();

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as Element;
      const attrs = Array.from(elem.attributes); // Create a copy as we may modify the collection
      for (const attr of attrs) {
        if (attr.name === '...' && attr.value === MARKER) {
          parts.push(new SpreadPart(elem));
          elem.removeAttribute('...');
        } else if (attr.value === MARKER) {
          let name = attr.name;
          let type: PartType = 'attribute';
          if (name === 'ref') {
            type = 'ref';
          } else if (name.startsWith('.')) {
            name = name.slice(1);
            type = 'property';
          } else if (name.startsWith('?')) {
            name = name.slice(1);
            type = 'boolean';
          } else if (name.startsWith('@')) {
            name = name.slice(1);
            type = 'event';
          }
          elem.removeAttribute(attr.name);
          parts.push(new AttributePart(elem, name, type));
        } else if (attr.value.includes(MARKER)) {
          // Multi-interpolation
          const statics = attr.value.split(MARKER);
          const committer = new AttributeCommitter(elem, attr.name, statics);
          for (let i = 0; i < statics.length - 1; i++) {
            parts.push(new MultiAttributePart(committer, i));
          }
          elem.removeAttribute(attr.name);
        }
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      if (textNode.textContent?.includes(MARKER)) {
        const statics = textNode.textContent.split(MARKER);
        const frag = document.createDocumentFragment();
        for (let i = 0; i < statics.length; i++) {
          frag.appendChild(document.createTextNode(statics[i]));
          if (i < statics.length - 1) {
            const start = document.createComment('');
            const end = document.createComment('');
            frag.appendChild(start);
            frag.appendChild(end);
            parts.push(new ChildPart(start, end));
          }
        }
        nodesToReplace.set(textNode, frag);
      }
    }
  }

  // Defer DOM mutations until after the tree walk is complete
  for (const [node, frag] of nodesToReplace.entries()) {
    node.parentNode!.replaceChild(frag, node);
  }

  return parts;
}