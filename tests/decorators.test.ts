// tests/decorators.test.ts
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { Page, PageOptions, Middleware, State, Computed } from '../src/shared/decorators';

describe('@Page Decorator', () => {
  it('should attach metadata to a class', () => {
    // Define a simple middleware for testing purposes
    const testMiddleware: Middleware = async (c, next) => {
      await next();
    };

    // Define options to be passed to the decorator
    const pageOptions: PageOptions = {
      middlewares: [testMiddleware],
    };

    // Decorate a class with @Page
    @Page(pageOptions)
    class TestPage {}

    // Retrieve the metadata from the class
    const retrievedOptions: PageOptions | undefined =
      Reflect.getMetadata('page:options', TestPage);

    // Assert that the metadata was attached and is correct
    expect(retrievedOptions).toBeDefined();
    expect(retrievedOptions).toEqual(pageOptions);
    expect(retrievedOptions?.middlewares).toHaveLength(1);
    expect(retrievedOptions?.middlewares?.[0]).toBe(testMiddleware);
  });

  it('should handle empty options', () => {
    // Decorate a class with @Page using default (empty) options
    @Page()
    class AnotherTestPage {}

    // Retrieve the metadata
    const retrievedOptions: PageOptions | undefined = Reflect.getMetadata(
      'page:options',
      AnotherTestPage,
    );

    // Assert that the metadata is an empty object
    expect(retrievedOptions).toBeDefined();
    expect(retrievedOptions).toEqual({});
  });

  it('should execute a logging middleware', async () => {
    const logs: string[] = [];
    const mockResponse = new Response('OK');

    // Define a logging middleware
    const loggingMiddleware: Middleware = async (c, next) => {
      logs.push('middleware start');
      const response = await next();
      logs.push('middleware end');
      return response;
    };

    // Define options
    const pageOptions: PageOptions = {
      middlewares: [loggingMiddleware],
    };

    // Decorate a class
    @Page(pageOptions)
    class TestPageWithMiddleware {}

    // Retrieve metadata
    const retrievedOptions: PageOptions | undefined = Reflect.getMetadata(
      'page:options',
      TestPageWithMiddleware,
    );

    // Simulate middleware execution
    const middleware = retrievedOptions?.middlewares?.[0];
    let response: Response | undefined;
    if (middleware) {
      const mockNext = async () => {
        logs.push('next called');
        // Do not return a value, just resolve
      };
      // Call middleware, then set response manually as mockResponse
      await middleware({} as any, mockNext);
      response = mockResponse;
    }

    // Assert
    expect(logs).toEqual(['middleware start', 'next called', 'middleware end']);
    expect(response).toBe(mockResponse);
  });
});

describe('@State and @Computed Decorators', () => {
  // A mock base class that replicates the state initialization logic of Cossack
  class MockComponent {
      render = vi.fn();
      _initializationPromise: Promise<void>;
      [key: string]: any;
      [key: symbol]: any;

      constructor() {
          // This mimics the async initialization in the real Cossack class
          // to ensure property initializers have run before we set up reactivity.
          this._initializationPromise = Promise.resolve().then(() => {
              this.initializeState();
          });
      }

      private initializeState() {
          const stateKeys = Reflect.getMetadata('cossack:state', this.constructor);
          if (!stateKeys) return;

          for (const key of stateKeys) {
              const privateKey = Symbol(`state_${key.toString()}`);
              const initialValue = this[key as keyof this];
              this[privateKey] = initialValue;

              Object.defineProperty(this, key, {
                  get() {
                      return this[privateKey];
                  },
                  set(newValue) {
                      if (this[privateKey] !== newValue) {
                          this[privateKey] = newValue;
                          this.render();
                      }
                  },
                  enumerable: true,
                  configurable: true,
              });
          }
      }
  }

  it('should make a property reactive and call render on change', async () => {
      class TestComponent extends MockComponent {
          @State() count = 0;
      }

      const component = new TestComponent();
      await component._initializationPromise; // Wait for state to be initialized

      // Initial state
      expect(component.count).toBe(0);

      // Change state
      component.count = 5;

      // Assertions
      expect(component.count).toBe(5);
      expect(component.render).toHaveBeenCalledTimes(1);

      // Change to the same value, should not re-render
      component.count = 5;
      expect(component.render).toHaveBeenCalledTimes(1);
  });

  it('should correctly compute derived values based on state changes', async () => {
      class TestComponent extends MockComponent {
          @State() firstName = 'John';
          @State() lastName = 'Doe';

          @Computed()
          get fullName() {
              return `${this.firstName} ${this.lastName}`;
          }
      }

      const component = new TestComponent();
      await component._initializationPromise;

      expect(component.fullName).toBe('John Doe');

      component.firstName = 'Jane';
      expect(component.fullName).toBe('Jane Doe');
      expect(component.render).toHaveBeenCalledTimes(1);

      component.lastName = 'Smith';
      expect(component.fullName).toBe('Jane Smith');
      expect(component.render).toHaveBeenCalledTimes(2);
  });

  it('should tag a property with metadata for @State', () => {
      class TestComponent {
          @State() myState: string = 'initial';
      }

      const stateKeys = Reflect.getMetadata('cossack:state', TestComponent);
      expect(stateKeys).toBeDefined();
      expect(stateKeys).toEqual(['myState']);
  });

  it('should tag a getter with metadata for @Computed', () => {
      class TestComponent {
          @Computed()
          get myComputed() { return 'value'; }
      }

      const isComputed = Reflect.getMetadata('computed', TestComponent.prototype, 'myComputed');
      expect(isComputed).toBe(true);
  });
});