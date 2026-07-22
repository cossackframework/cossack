import { TemplateResult, render, hydrate, html, isTemplateResult } from './cossack-html';
import { Context } from './context';
import { getFinalizedStyles } from './css';
import type { CSSResultGroup, FinalizedStyles } from './css';

export type PropertyDeclaration = {
  type?: unknown;
  reflect?: boolean;
  state?: boolean;
};

export interface PropertyDeclarations {
  [key: string]: PropertyDeclaration;
}

export type PropertyValues = Map<string | number | symbol, unknown>;

// --- Reactive Controllers ---

export interface ReactiveController {
  hostConnected?(): void;
  hostDisconnected?(): void;
  hostUpdate?(): void;
  hostUpdated?(): void;
}

export interface ReactiveControllerHost {
  requestUpdate(): void;
  addController(controller: ReactiveController): void;
  removeController(controller: ReactiveController): void;
  readonly updateComplete: Promise<boolean>;
}

// Global stack to track the current rendering component
export const instanceStack: CossackElement[] = [];

export const pushCurrentInstance = (instance: CossackElement) => instanceStack.push(instance);
export const popCurrentInstance = () => instanceStack.pop();

const styleTemplates = new WeakMap<Function, TemplateResult>();

const createStaticTemplate = (text: string): TemplateResult => {
  const strings = [text] as unknown as TemplateStringsArray;
  (strings as unknown as { raw: readonly string[] }).raw = strings;
  return new TemplateResult(strings, []);
};

const styleTemplateFor = (componentClass: Function, styles: FinalizedStyles): TemplateResult => {
  let template = styleTemplates.get(componentClass);
  if (!template) {
    // getFinalizedStyles() is intentionally idempotent per component class;
    // this cache relies on that invariant so a class always reuses the same
    // scope ID and managed style template across renders and instances.
    // A literal </style sequence would terminate the HTML element even when it
    // appears in CSS text. Escaping the slash is CSS-equivalent and keeps the
    // managed style node structurally stable for SSR/hydration.
    const safeCss = styles.cssText.replace(/<\/style/gi, '<\\/style');
    template = createStaticTemplate(`<style data-cossack-style="${styles.scopeId}">${safeCss}</style>`);
    styleTemplates.set(componentClass, template);
  }
  return template;
};

const wrapStyledOutput = (styles: TemplateResult, output: unknown): TemplateResult => html`${styles}${output}`;

export class CossackElement implements ReactiveControllerHost {
  static properties: PropertyDeclarations = {};
  static readonly _isCossackElement = true;
  static components: Record<string, typeof CossackElement> = {};
  static styles?: CSSResultGroup;

  // Holds content projected from the parent
  public children: unknown = null;
  public props: Record<string, unknown> = {};

  // Context Support
  public __parent: CossackElement | null = null;
  public _id: string = '';
  public _childCounter: number = 0;

  private __providedContexts: Map<Context<unknown>, unknown> = new Map();
  private __properties: Map<string, unknown> = new Map();
  private __updatePromise: Promise<boolean> | null = null;
  private __changedProperties: PropertyValues = new Map();
  private __renderListeners: Set<(template: TemplateResult | unknown | null) => void> = new Set();
  
  // Controllers
  private __controllers: Set<ReactiveController> = new Set();
  
  private __hasConnected = false;
  private __eventListeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map();

  constructor() {
    this.initialize();
  }

  // --- Static Stack Access for cossack-html ---
  static get currentRenderingInstance(): CossackElement | null {
      return instanceStack.length > 0 ? instanceStack[instanceStack.length - 1] : null;
  }

  resetRenderState() {
      this._childCounter = 0;
  }

  // --- Controller API ---
  
  addController(controller: ReactiveController) {
      this.__controllers.add(controller);
      if (this.__hasConnected && controller.hostConnected) {
          controller.hostConnected();
      }
  }

  removeController(controller: ReactiveController) {
      this.__controllers.delete(controller);
  }

  get updateComplete(): Promise<boolean> {
      return this.__updatePromise || Promise.resolve(true);
  }

  private initialize() {
     const ctor = this.constructor as typeof CossackElement;
     const props = (ctor as any).properties;
     if (props) {
        for (const [prop, options] of Object.entries(props as PropertyDeclarations)) {
            this.createProperty(prop, options);
        }
     }
  }

  private createProperty(name: string, _options: PropertyDeclaration) {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
        this.__properties.set(name, (this as any)[name]);
    }

    Object.defineProperty(this, name, {
      get() {
        return this.__properties.get(name);
      },
      set(value) {
        const oldValue = this.__properties.get(name);
        if (oldValue !== value) {
            this.__properties.set(name, value);
            this.requestUpdate(name, oldValue);
        }
      },
      configurable: true,
      enumerable: true,
    });
  }

  provide<T>(context: Context<T>, value: T) {
      this.__providedContexts.set(context, value);
  }

  consume<T>(context: Context<T>): T | undefined {
      let parent = this.__parent;
      while (parent) {
          if (parent.__providedContexts.has(context)) {
              return parent.__providedContexts.get(context) as T;
          }
          parent = parent.__parent;
      }
      return context.defaultValue;
  }

  requestUpdate(name?: string, oldValue?: unknown) {
    if (name !== undefined) {
        if (!this.__changedProperties.has(name)) {
             this.__changedProperties.set(name, oldValue);
        }
    }
    if (!this.__updatePromise) {
      this.__updatePromise = this.performUpdate();
    }
    return this.__updatePromise;
  }

  protected async performUpdate() {
    await Promise.resolve();
    let shouldUpdate = false;
    try {
        shouldUpdate = this.shouldUpdate(this.__changedProperties);
        if (shouldUpdate) {
            // Controller hostUpdate
            this.__controllers.forEach(c => c.hostUpdate && c.hostUpdate());

            this.willUpdate(this.__changedProperties);

            this.resetRenderState();
            pushCurrentInstance(this);

            const template = this._finalizeRenderOutput(this.render());

            this.__notifyListeners(template);

            popCurrentInstance();

            this.updated(this.__changedProperties);

            // Controller hostUpdated
            this.__controllers.forEach(c => c.hostUpdated && c.hostUpdated());
        }
    } catch (e) {
        console.error('Error during update:', e);
        if (instanceStack[instanceStack.length - 1] === this) {
            popCurrentInstance();
        }
    }

    this.__changedProperties = new Map();
    this.__updatePromise = null;
    return shouldUpdate;
  }

  private __notifyListeners(template: TemplateResult | unknown | null) {
      this.__renderListeners.forEach(listener => listener(template));
  }

  addRenderListener(listener: (template: TemplateResult | unknown | null) => void) {
      this.__renderListeners.add(listener);
  }

  removeRenderListener(listener: (template: TemplateResult | unknown | null) => void) {
      this.__renderListeners.delete(listener);
  }

  /** @internal Return the deterministic Light DOM style scope for this class. */
  public _getStyleScopeId(): string | undefined {
      return getFinalizedStyles(this.constructor as typeof CossackElement)?.scopeId;
  }

  /**
   * @internal Shared output finalizer used by standalone elements, nested
   * component() rendering, and the core Cossack page/layout/app path.
   */
  public _finalizeRenderOutput(value: TemplateResult | unknown | null): TemplateResult | unknown | null {
      const styles = getFinalizedStyles(this.constructor as typeof CossackElement);
      this._claimTemplateOwnership(value, styles?.scopeId);
      if (!styles) return value;
      return wrapStyledOutput(styleTemplateFor(this.constructor, styles), value);
  }

  private _claimTemplateOwnership(value: unknown, scopeId?: string): void {
      if (!value || typeof value !== 'object') return;
      if ((value as any)._type === 'COMPONENT') {
          const component = value as any;
          component.parent = this;
          this._claimTemplateOwnership(component.children, scopeId);
          return;
      }
      if (isTemplateResult(value)) {
          if (value.__cossackOwner && value.__cossackOwner !== this) return;
          value.__cossackOwner = this;
          value.__cossackScope = scopeId;
          for (const nested of value.values) this._claimTemplateOwnership(nested, scopeId);
          return;
      }
      if (Array.isArray(value)) {
          for (const nested of value) this._claimTemplateOwnership(nested, scopeId);
      }
  }

  mount(container: HTMLElement, hydrateFirst = false) {
      let firstRender = hydrateFirst;
      this.addRenderListener((template) => {
          if (template) {
              const result = isTemplateResult(template) ? template : html`${template}`;
              // On the very first render after a server-side render, hydrate
              // the existing DOM in place (preserving the SSR nodes) instead
              // of wiping and rebuilding. Subsequent updates use the normal
              // render() path, which reconciles via the container cache.
              if (firstRender) {
                  firstRender = false;
                  hydrate(result, container);
              } else {
                  render(result, container);
              }
          }
      });
      this.requestUpdate();
  }

  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, _options?: boolean | AddEventListenerOptions) {
      if (!callback) return;
      if (!this.__eventListeners.has(type)) {
          this.__eventListeners.set(type, new Set());
      }
      this.__eventListeners.get(type)!.add(callback);
  }

  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, _options?: boolean | EventListenerOptions) {
      if (!callback) return;
      const listeners = this.__eventListeners.get(type);
      if (listeners) {
          listeners.delete(callback);
      }
  }

  dispatchEvent(event: Event): boolean {
      const listeners = this.__eventListeners.get(event.type);
      if (listeners) {
          listeners.forEach(listener => {
              if (typeof listener === 'function') {
                  listener.call(this, event);
              } else {
                  listener.handleEvent(event);
              }
          });
      }
      return !event.defaultPrevented;
  }

  shouldUpdate(_changedProperties: PropertyValues): boolean {
    return true;
  }

  willUpdate(_changedProperties: PropertyValues) {}

  render(): TemplateResult | null {
    return null;
  }

  updated(_changedProperties: PropertyValues) {}

  connectedCallback() {
      this.__hasConnected = true;
      this.__controllers.forEach(c => c.hostConnected && c.hostConnected());
  }
  
  disconnectedCallback() {
      this.__hasConnected = false;
      this.__controllers.forEach(c => c.hostDisconnected && c.hostDisconnected());
  }
}
