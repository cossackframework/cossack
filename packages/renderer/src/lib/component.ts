import { TemplateResult } from './types';
import { render } from './client/render';

// Isomorphic Base Class
const Base = (typeof HTMLElement !== 'undefined' ? HTMLElement : class {
    // Mock methods for Server Side
    getAttribute(_name: string): string | null { return null; }
    setAttribute(_name: string, _value: string) {}
    removeAttribute(_name: string) {}
    hasAttribute(_name: string) { return false; }
    addEventListener(_type: string, _listener: any, _options?: any) {}
    removeEventListener(_type: string, _listener: any, _options?: any) {}
    dispatchEvent(_event: Event): boolean { return true; }
    // Mock child manipulation
    childNodes: any[] = [];
    appendChild(_node: any) {}
}) as typeof HTMLElement;

export interface ComponentOptions {
    tag: string;
}

export type PropertyValues = Map<string | symbol, unknown>;

export abstract class CossackElement extends Base {
    private _updatePending = false;
    private _hasConnected = false;
    private _changedProperties: PropertyValues = new Map();
    
    // Captured Light DOM children
    private _originalChildren: Node[] = [];

    /**
     * Access the original Light DOM children.
     * Use this in your render() method to project content.
     */
    get originalChildren(): Node[] {
        return this._originalChildren;
    }

    // Abstract-ish render method
    abstract render(): TemplateResult | unknown;

    // --- Lifecycle Methods ---

    connectedCallback() {
        this._hasConnected = true;
        
        // Capture children on first connect if not already captured
        const nodes = (this as unknown as { childNodes: ArrayLike<Node> }).childNodes;
        if (nodes.length > 0 && this._originalChildren.length === 0) {
            this._originalChildren = Array.from(nodes);
        }

        this.requestUpdate();
    }

    disconnectedCallback() {
        this._hasConnected = false;
    }

    /**
     * Called after the element's DOM has been updated.
     * @param changedProperties Map of properties that changed.
     */
    updated(_changedProperties: PropertyValues) {
        // Hook for subclasses
    }

    // --- Rendering & Updates ---

    requestUpdate(name?: string | symbol, oldValue?: unknown) {
        if (name !== undefined) {
             // Only store the old value if we haven't already recorded a change for this prop
            if (!this._changedProperties.has(name)) {
                this._changedProperties.set(name, oldValue);
            }
        }

        if (this._updatePending) return;
        this._updatePending = true;

        if (typeof window !== 'undefined') {
            // Client: Batch updates
            Promise.resolve().then(() => this._performUpdate());
        } else {
            // Server: No-op or immediate
            this._updatePending = false;
        }
    }

    private _performUpdate() {
        if (!this._hasConnected) {
            this._updatePending = false;
            return;
        }

        const changedProps = new Map(this._changedProperties);
        this._updatePending = false;
        this._changedProperties.clear();

        const result = this.render();
        if (result instanceof TemplateResult) {
            render(result, this as unknown as Element);
        }

        // Notify lifecycle
        this.updated(changedProps);
    }
}

// --- Decorators ---

export function Component(options: ComponentOptions) {
    return function <T extends CustomElementConstructor>(constructor: T): T | void {
        if (typeof customElements !== 'undefined') {
            try {
                if (!customElements.get(options.tag)) {
                     customElements.define(options.tag, constructor);
                }
            } catch (e) {
                console.warn(`Failed to define custom element ${options.tag}:`, e);
            }
        }
        return constructor;
    };
}

export function State() {
    return function (target: any, propertyKey: string) {
        const internalKey = `__${propertyKey}`;
        
        Object.defineProperty(target, propertyKey, {
            get() {
                return this[internalKey];
            },
            set(newVal) {
                const oldVal = this[internalKey];
                if (oldVal !== newVal) {
                    this[internalKey] = newVal;
                    if (this instanceof CossackElement) {
                        this.requestUpdate(propertyKey, oldVal);
                    }
                }
            },
            enumerable: true,
            configurable: true,
        });
    };
}

export const Prop = State;