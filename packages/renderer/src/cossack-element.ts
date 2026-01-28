import { TemplateResult, render, html, isTemplateResult } from './cossack-html';
import { Context } from './context';

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
const instanceStack: CossackElement[] = [];

export const pushCurrentInstance = (instance: CossackElement) => instanceStack.push(instance);
export const popCurrentInstance = () => instanceStack.pop();

export class CossackElement implements ReactiveControllerHost {
  static properties: PropertyDeclarations = {};
  static components: Record<string, new () => CossackElement> = {};
  static readonly _isCossackElement = true;

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
            
            const template = this.render();
            
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

  mount(container: HTMLElement) {
      this.addRenderListener((template) => {
          if (template) {
             if (isTemplateResult(template)) {
                 render(template, container);
             } else {
                 render(html`${template}`, container);
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
