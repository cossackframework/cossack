import { ComponentResult, isComponentResult } from './component';
import { CossackElement, pushCurrentInstance, popCurrentInstance } from './cossack-element';
import { LiveResult, RepeatResult } from './directives';

export class TemplateResult {
  public readonly _cossack_template_result = true;
  constructor(
    public readonly strings: TemplateStringsArray,
    public readonly values: unknown[]
  ) {}
}

export const html = (strings: TemplateStringsArray, ...values: unknown[]) => {
  return new TemplateResult(strings, values);
};

export const svg = html;

export const component = <T extends CossackElement>(
    clazz: new () => T,
    props: Record<string, unknown> = {},
    children?: unknown
): TemplateResult => {
    const raw: ComponentResult = {
        _type: 'COMPONENT',
        clazz,
        props,
        children
    };
    return html`${raw}`;
};

export const isTemplateResult = (value: unknown): value is TemplateResult => {
    return typeof value === 'object' && value !== null && (value as any)._cossack_template_result === true;
};

export class UnsafeHTMLResult {
    constructor(public readonly value: string) {}
}

export const unsafeHTML = (value: string) => new UnsafeHTMLResult(value);

export const isUnsafeHTML = (value: unknown): value is UnsafeHTMLResult => {
    return value instanceof UnsafeHTMLResult;
};

// --- SSR Implementation ---

export const escapeHtml = (unsafe: unknown): string => {
    const str = String(unsafe);
    return str
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
};

const valueToString = (value: unknown): string => {
  if (value === null || value === undefined || value === false) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(valueToString).join('');
  }
  if (isTemplateResult(value)) {
    return renderToString(value);
  }
  if (value instanceof LiveResult) {
      return valueToString(value.value);
  }
  if (value instanceof RepeatResult) {
      return value.items.map((item, i) => valueToString(value.templateFn(item, i))).join('');
  }
  if (isComponentResult(value)) {
      const instance = new value.clazz();
      Object.assign(instance, value.props);
      if ('props' in instance) {
          (instance as any).props = value.props;
      }
      instance.children = value.children;
      instance.__parent = CossackElement.currentRenderingInstance;
      
      pushCurrentInstance(instance);
      (instance as any).willUpdate(new Map()); 
      const template = instance.render();
      let res = '';
      if (template) {
          if (isTemplateResult(template)) {
              res = renderToString(template);
          } else {
              res = renderToString(html`${template}`);
          }
      }
      popCurrentInstance();
      return res;
  }
  if (isUnsafeHTML(value)) {
      return value.value; 
  }
  if (typeof value === 'function') {
      return '';
  }
  return escapeHtml(value);
};

const renderSpread = (obj: unknown): string => {
    let output = '';
    if (typeof obj === 'object' && obj !== null) {
        for (const [k, v] of Object.entries(obj)) {
             if (k.startsWith('@')) continue; 
             
             let name = k;
             let val = v;
             
             if (k.startsWith('?')) {
                 if (v) output += ` ${k.slice(1)}`;
                 continue;
             }
             if (k.startsWith('.')) {
                 name = k.slice(1);
             }
             
             if (typeof val === 'boolean') {
                 if (val) output += ` ${name}`;
             } else if (typeof val === 'function') {
                 // Ignore
             } else if (val !== null && val !== undefined) {
                 output += ` ${name}="${escapeHtml(val)}"`;
             }
        }
    }
    return output;
};

class SSRScanner {
    private result: string = '';
    private stringIdx = 0;
    private charIdxForNext = 0;

    constructor(private resultObj: TemplateResult) {}

    scan(): string {
        const { strings, values } = this.resultObj;

        while (this.stringIdx < strings.length) {
            const str = strings[this.stringIdx];
            const remaining = str.substring(this.charIdxForNext || 0);

            const attrMatch = remaining.match(/(\.\.\.|[.@?]?[a-zA-Z0-9_-]+)=["']?$/);

            this.result += remaining;
            this.charIdxForNext = 0;

            if (this.stringIdx < strings.length - 1) {
                const val = values[this.stringIdx];
                if (attrMatch) {
                    const fullMatch = attrMatch[0];
                    const name = attrMatch[1];

                    this.result = this.result.substring(0, this.result.length - fullMatch.length);

                    // Check if we opened a quote
                    const quote = fullMatch.endsWith('"') ? '"' : fullMatch.endsWith("'") ? "'" : '';

                    let replaced = true;

                    if (name === '...') {
                        this.result = this.result.trimEnd();
                        this.result += renderSpread(val);
                    } else if (name.startsWith('@')) {
                        this.result = this.result.trimEnd();
                    } else if (name.startsWith('?')) {
                        if (val) {
                            this.result = this.result.trimEnd();
                            this.result += ` ${name.slice(1)}`;
                        } else {
                            this.result = this.result.trimEnd();
                        }
                    } else if (name.startsWith('.')) {
                        if (val !== null && val !== undefined && val !== false) {
                            this.result = this.result.trimEnd();
                            this.result += ` ${name.slice(1)}="${valueToString(val)}"`;
                        } else {
                            this.result = this.result.trimEnd();
                        }
                    } else {
                        this.result += fullMatch;
                        this.result += valueToString(val);
                        replaced = false;
                    }

                    // Consume closing quote if we replaced the attribute logic (suppressed or rewrote)
                    if (quote && replaced) {
                         const nextStr = strings[this.stringIdx + 1];
                         if (nextStr && nextStr.startsWith(quote)) {
                             this.charIdxForNext = 1;
                         }
                    }
                } else {
                    this.result += valueToString(val);
                }
            }
            this.stringIdx++;
        }
        return this.result;
    }
}

export const renderToString = (result: TemplateResult): string => {
  const scanner = new SSRScanner(result);
  return scanner.scan();
};

// --- Client-Side Implementation ---

interface Part {
  update(value: unknown): void;
}

class NodePart implements Part {
  private componentInstance: CossackElement | null = null;
  private renderListener: ((t: TemplateResult | unknown | null) => void) | null = null;
  private _childParts: NodePart[] = [];
  private _partKeys: unknown[] = [];
  // Cache for nested template result updates
  private _cachedTemplateStrings: TemplateStringsArray | null = null;
  private _cachedParts: Part[] | null = null;

  constructor(public startNode: Comment, public endNode: Comment) {}

  update(value: unknown) {
      if (this.componentInstance && (!isComponentResult(value) || value.clazz !== this.componentInstance.constructor)) {
          this.disposeComponent();
      }
      if (!(value instanceof RepeatResult) && !Array.isArray(value) && this._childParts.length > 0) {
          this.clearChildParts();
      }
      if (isComponentResult(value)) {
          this.updateComponent(value);
      } else if (value instanceof RepeatResult) {
          this.updateRepeat(value);
      } else if (Array.isArray(value)) {
          this.updateArray(value);
      } else {
          this.updateNode(value);
      }
  }
  
  private disposeComponent() {
      if (this.componentInstance) {
        if (this.renderListener) {
            this.componentInstance.removeRenderListener(this.renderListener);
        }
        this.componentInstance.disconnectedCallback();
        this.componentInstance = null;
        this.renderListener = null;
        this._clearTemplateCache();
      }
  }

  private updateComponent(result: ComponentResult) {
      if (!this.componentInstance) {
          this.componentInstance = new result.clazz();
          this.componentInstance.__parent = CossackElement.currentRenderingInstance;
          if (this.componentInstance.__parent) {
              this.componentInstance._id = `${this.componentInstance.__parent._id}:${this.componentInstance.__parent._childCounter++}`;
          }
          this.renderListener = (template) => {
              this.updateNode(template); 
          };
          this.componentInstance.addRenderListener(this.renderListener);
          this.componentInstance.connectedCallback();
      }
      const instance = this.componentInstance;
      Object.assign(instance, result.props);
      if ('props' in instance) {
          (instance as any).props = result.props;
      }
      instance.children = result.children;
      instance.requestUpdate();
  }

  private updateRepeat(result: RepeatResult) {
      const { items, keyFn, templateFn } = result;
      const oldPartsMap = new Map<unknown, NodePart>();
      this._childParts.forEach((part, i) => {
          const key = this._partKeys[i];
          if (key !== undefined) oldPartsMap.set(key, part);
      });
      const newParts: NodePart[] = [];
      const newKeys: unknown[] = [];
      let insertAfterNode: Node = this.startNode;
      items.forEach((item, index) => {
          const key = keyFn(item, index);
          newKeys.push(key);
          let part = oldPartsMap.get(key);
          if (part) {
              oldPartsMap.delete(key);
              if (part.startNode.previousSibling !== insertAfterNode) {
                  this.movePart(part, insertAfterNode);
              }
              part.update(templateFn(item, index));
          } else {
              part = this.createChildPart(insertAfterNode);
              part.update(templateFn(item, index));
          }
          newParts.push(part);
          insertAfterNode = part.endNode;
      });
      oldPartsMap.forEach(part => part.dispose());
      this._childParts = newParts;
      this._partKeys = newKeys;
  }
  
  private updateArray(values: unknown[]) {
      this._partKeys = [];
      const minLength = Math.min(values.length, this._childParts.length);
      for (let i = 0; i < minLength; i++) {
          this._childParts[i].update(values[i]);
      }
      if (values.length > this._childParts.length) {
          let lastNode = this._childParts.length > 0 ? this._childParts[this._childParts.length-1].endNode : this.startNode;
          for (let i = minLength; i < values.length; i++) {
              const part = this.createChildPart(lastNode);
              this._childParts.push(part);
              part.update(values[i]);
              lastNode = part.endNode;
          }
      }
      if (values.length < this._childParts.length) {
          for (let i = this._childParts.length - 1; i >= values.length; i--) {
              const part = this._childParts[i];
              part.dispose();
              this._childParts.pop();
          }
      }
  }

  private createChildPart(insertAfter: Node): NodePart {
      const start = document.createComment('CRP-Item');
      const end = document.createComment('/CRP-Item');
      const next = insertAfter.nextSibling;
      insertAfter.parentNode!.insertBefore(start, next);
      insertAfter.parentNode!.insertBefore(end, next);
      return new NodePart(start, end);
  }

  private movePart(part: NodePart, insertAfter: Node) {
      const parent = insertAfter.parentNode!;
      const nodes: Node[] = [];
      let current: Node | null = part.startNode;
      while (current && current !== part.endNode) {
          nodes.push(current);
          current = current.nextSibling;
      }
      nodes.push(part.endNode);
      const ref = insertAfter.nextSibling;
      nodes.forEach(node => parent.insertBefore(node, ref));
  }

  private clearChildParts() {
      this._childParts.forEach(part => part.dispose());
      this._childParts = [];
      this._partKeys = [];
  }

  dispose() {
      this.clear();
      this._clearTemplateCache();
      this.clearChildParts();
      if (this.startNode.parentNode) this.startNode.parentNode.removeChild(this.startNode);
      if (this.endNode.parentNode) this.endNode.parentNode.removeChild(this.endNode);
      if (this.componentInstance) {
           if (this.renderListener) {
                this.componentInstance.removeRenderListener(this.renderListener);
            }
           this.componentInstance.disconnectedCallback();
      }
  }

  private updateNode(value: unknown) {
    if (!this.startNode.parentNode) return;
    if (isTemplateResult(value)) {
       // Check if we have a cached template with the same strings
       if (this._cachedTemplateStrings === value.strings && this._cachedParts) {
           // Template structure is the same, just update the parts
           this._cachedParts.forEach((part, i) => {
               part.update(value.values[i]);
           });
       } else {
           // Template structure changed, clear and re-render
           this._clearTemplateCache();
           this.clear();
           const container = document.createDocumentFragment();
           render(value, container);
           this.startNode.parentNode!.insertBefore(container, this.endNode);
           // Cache the template strings and parts for future updates
           const cached = containerCache.get(container.firstChild?.childNodes[0] || container);
           if (cached) {
               this._cachedTemplateStrings = cached.strings;
               this._cachedParts = cached.parts;
           }
       }
    } else if (isComponentResult(value) || (typeof value === 'object' && value !== null && !(value instanceof Node) && !Array.isArray(value))) {
        // Handle ComponentResult or other objects by wrapping in template
       this._clearTemplateCache();
       this.clear();
       const container = document.createDocumentFragment();
       render(html`${value}`, container);
       this.startNode.parentNode!.insertBefore(container, this.endNode);
    } else if (isUnsafeHTML(value)) {
       this._clearTemplateCache();
       this.clear();
       const temp = document.createElement('template');
       temp.innerHTML = value.value;
       this.startNode.parentNode!.insertBefore(temp.content, this.endNode);
    } else if (value instanceof Node) {
       this._clearTemplateCache();
       this.clear();
       this.startNode.parentNode!.insertBefore(value, this.endNode);
    } else if (value === null || value === undefined || value === false) {
       this._clearTemplateCache();
       this.clear();
    } else {
        const text = String(value);
        const node = this.startNode.nextSibling;
        if (node && node.nodeType === Node.TEXT_NODE && node.nextSibling === this.endNode) {
            if (node.nodeValue !== text) node.nodeValue = text;
        } else {
            this._clearTemplateCache();
            this.clear();
            const textNode = document.createTextNode(text);
            this.startNode.parentNode!.insertBefore(textNode, this.endNode);
        }
    }
  }

  private _clearTemplateCache() {
      this._cachedTemplateStrings = null;
      this._cachedParts = null;
  }

  clear() {
    let node = this.startNode.nextSibling;
    while (node && node !== this.endNode) {
        const next = node.nextSibling;
        node.parentNode!.removeChild(node);
        node = next;
    }
  }
}

class SpreadPart implements Part {
    private previousValues: Record<string, unknown> = {};
    constructor(public element: Element) {}
    update(value: unknown) {
        if (typeof value !== 'object' || value === null) return;
        const props = value as Record<string, unknown>;
        
        for (const key of Object.keys(this.previousValues)) {
            if (!(key in props)) {
                if (key.startsWith('@')) {
                     const eventName = key.slice(1);
                     const propName = `__crp_handler_${eventName}`;
                     const oldHandler = (this.element as any)[propName];
                     if (oldHandler) this.element.removeEventListener(eventName, oldHandler);
                } else if (key.startsWith('.')) {
                    // Prop
                } else if (key.startsWith('?')) {
                    this.element.removeAttribute(key.slice(1));
                } else {
                    this.element.removeAttribute(key);
                }
            }
        }

        for (const [key, val] of Object.entries(props)) {
             if (key.startsWith('@') && typeof val === 'function') {
                 const eventName = key.slice(1);
                 const propName = `__crp_handler_${eventName}`;
                 const oldHandler = (this.element as any)[propName];
                 if (oldHandler) this.element.removeEventListener(eventName, oldHandler);
                 (this.element as any)[propName] = val;
                 this.element.addEventListener(eventName, val as EventListener);
             } else if (key.startsWith('.')) {
                 (this.element as any)[key.slice(1)] = val;
             } else if (key.startsWith('?')) {
                 if (val) this.element.setAttribute(key.slice(1), '');
                 else this.element.removeAttribute(key.slice(1));
             } else if (typeof val === 'boolean') {
                 if (val) this.element.setAttribute(key, '');
                 else this.element.removeAttribute(key);
             } else if (val !== null && val !== undefined) {
                 this.element.setAttribute(key, String(val));
             }
        }
        this.previousValues = { ...props };
    }
}

class AttributePart implements Part {
    constructor(public element: Element, public name: string) {}
    update(value: unknown) {
        let isLive = false;
        if (value instanceof LiveResult) {
            isLive = true;
            value = value.value;
        }
        if (this.name === 'ref' && typeof value === 'function') {
            (value as (...args: any[]) => void)(this.element);
            if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
            return;
        }
        
        if (this.name.startsWith('@') && typeof value === 'function') {
            const eventName = this.name.slice(1);
            const propName = `__crp_handler_${eventName}`;
            const oldHandler = (this.element as any)[propName];
            if (oldHandler) this.element.removeEventListener(eventName, oldHandler);
            (this.element as any)[propName] = value;
            this.element.addEventListener(eventName, value as EventListener);
            if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
        } else if (this.name.startsWith('.')) {
            const propName = this.name.slice(1);
            (this.element as any)[propName] = value;
            if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
        } else if (this.name.startsWith('?')) {
            const attrName = this.name.slice(1);
            if (value) this.element.setAttribute(attrName, '');
            else this.element.removeAttribute(attrName);
            if (this.element.hasAttribute(this.name)) this.element.removeAttribute(this.name);
        } else if (this.name === 'value' && (this.element instanceof HTMLInputElement || this.element instanceof HTMLTextAreaElement)) {
            if (isLive) {
                if (this.element.value !== String(value)) this.element.value = String(value);
            } else {
                if (this.element.value !== String(value)) this.element.value = String(value);
            }
            this.element.setAttribute(this.name, String(value));
        } else if (this.name === 'checked' && this.element instanceof HTMLInputElement) {
             const boolValue = Boolean(value);
             if (this.element.checked !== boolValue) this.element.checked = boolValue;
             if (boolValue) this.element.setAttribute(this.name, '');
             else this.element.removeAttribute(this.name);
        } else if (typeof value === 'boolean') {
            if (value) this.element.setAttribute(this.name, '');
            else this.element.removeAttribute(this.name);
        } else {
            this.element.setAttribute(this.name, String(value));
        }
    }
}

const containerCache = new WeakMap<Node, { strings: TemplateStringsArray, parts: Part[] }>();

export const render = (result: TemplateResult, container: Node) => {
    const existing = containerCache.get(container);
    if (existing && existing.strings === result.strings) {
        existing.parts.forEach((part, i) => {
            part.update(result.values[i]);
        });
        return;
    }

    const parts: Part[] = [];
    const values = result.values;

    let htmlString = '';
    let isInsideTag = false;

    const updateState = (str: string) => {
        for (let i = 0; i < str.length; i++) {
            if (str[i] === '<' && str[i+1] !== '!' && str[i+1] !== '/') {
                isInsideTag = true;
            } else if (str[i] === '>') {
                isInsideTag = false;
            }
        }
    };

    const attrMatch = /(\.\.\.|[.@?]?[a-zA-Z0-9_-]+)=["']?$/;

    for (let i = 0; i < result.strings.length - 1; i++) {
        const str = result.strings[i];
        updateState(str);

        htmlString += str;

        const match = str.match(attrMatch);
        if (isInsideTag && match) {
            htmlString += `__CRP_${i}__`;
        } else {
            htmlString += `<!--CRP_${i}-->`;
        }
    }

    const lastStr = result.strings[result.strings.length - 1];
    updateState(lastStr);
    htmlString += lastStr;

    const template = document.createElement('template');
    template.innerHTML = htmlString;
    const instance = template.content.cloneNode(true);
    
    const walker = document.createTreeWalker(instance, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
    let currentNode: Node | null;
    
    const nodes: Node[] = [];
    while ((currentNode = walker.nextNode())) {
        nodes.push(currentNode);
    }

    nodes.forEach(node => {
        if (node.nodeType === Node.COMMENT_NODE) {
            const match = node.nodeValue?.match(/CRP_(\d+)/);
            if (match) {
                const index = parseInt(match[1]);
                const endNode = document.createComment('/CRP');
                node.parentNode!.insertBefore(endNode, node.nextSibling);
                const part = new NodePart(node as Comment, endNode);
                parts[index] = part;
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
             const el = node as Element;

             Array.from(el.attributes).forEach(attr => {
                const match = attr.value.match(/__CRP_(\d+)__/);
                if (match) {
                    const index = parseInt(match[1]);
                    if (!parts[index]) {
                         if (attr.name === '...') {
                             const part = new SpreadPart(el);
                             parts[index] = part;
                             el.removeAttribute('...');
                         } else {
                             const part = new AttributePart(el, attr.name);
                             parts[index] = part;
                         }
                    }
                }
            });
        }
    });

    for (let i = 0; i < values.length; i++) {
        if (parts[i]) {
            parts[i].update(values[i]);
        }
    }

    if (container instanceof HTMLElement) {
        container.innerHTML = '';
        container.appendChild(instance);
    } else if (container instanceof DocumentFragment) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        container.appendChild(instance);
    }

    containerCache.set(container, { strings: result.strings, parts });
};