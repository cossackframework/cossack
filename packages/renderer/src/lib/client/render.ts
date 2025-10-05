import { TemplateResult, Part, PartType } from '../types';
import { AttributePart, ChildPart, SpreadPart } from './parts';

class Template {
  element: HTMLTemplateElement;
  strings: TemplateStringsArray;

  constructor(strings: TemplateStringsArray) {
    this.strings = strings;
    const html = strings.join('?');
    this.element = document.createElement('template');
    this.element.innerHTML = html;
  }
}

export function render(result: TemplateResult, container: Element | DocumentFragment): void {
  if (typeof document === 'undefined') {
    throw new Error('DOM container provided, but no document available (e.g., not in browser)');
  }

  const extContainer: any = container;

  if (!extContainer._template || extContainer._template.strings !== result.strings) {
    extContainer._template = new Template(result.strings);

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const clone = extContainer._template.element.content.cloneNode(true);
    container.appendChild(clone);

    extContainer._parts = createParts(container);
    extContainer._values = [];
  }

  const parts: Part[] = extContainer._parts;
  const oldValues: unknown[] = extContainer._values;
  extContainer._values = [...result.values];

  for (let i = 0; i < result.values.length; i++) {
    if (result.values[i] !== oldValues[i]) {
      parts[i].commit(result.values[i]);
    }
  }
}

function createParts(container: Element | DocumentFragment): Part[] {
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
        if (attr.name === '...' && attr.value === '?') {
          parts.push(new SpreadPart(elem));
          elem.removeAttribute('...');
        } else if (attr.value === '?') {
          let name = attr.name;
          let type: PartType = 'attribute';
          if (name.startsWith('.')) {
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
        }
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      if (textNode.textContent?.includes('?')) {
        const statics = textNode.textContent.split('?');
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