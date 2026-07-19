// tests/cossack.server.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the environment to be server-side BEFORE anything else is imported
vi.mock('../src/shared/environment', () => ({
  isServer: true,
}));

import { Cossack } from '../src/shared/cossack';
import { State, Server, Client } from '../src/shared/decorators';
import { renderToString } from '@cossackframework/renderer';
import type { TemplateResult } from '@cossackframework/renderer';
import type { Context } from 'hono';

// Mock the renderer sub-imports
vi.mock('@cossackframework/renderer', () => {
    const createContext = <T>(defaultValue: T) => ({ defaultValue, _id: Math.random().toString() });
    class CossackElement {
        render() { return null; }
        requestUpdate() {}
        mount() {}
        updated() {}
        connectedCallback() {}
        disconnectedCallback() {}
        static properties = {};
        autoBindMethods() {}
        consume() { return undefined; }
        provide() {}
        resetRenderState() {}
    }
    return {
        render: vi.fn(),
        renderToString: vi.fn((template) => `SSR: ${template.strings.join('')}`),
        html: (strings: any, ...values: any[]) => ({ strings, values }),
        CossackElement,
        createContext,
        isTemplateResult: vi.fn(() => true),
        pushCurrentInstance: vi.fn(),
        popCurrentInstance: vi.fn(),
        instanceStack: [],
    };
});

import { Page } from '../src/shared/decorators';

// A concrete implementation for testing. This is now a top-level declaration.
@Page({ channels: ['private'] })
class TestComponent extends Cossack<{}> {
  @State() count = 0;
  @State({ channel: 'private' }) message = 'initial';

  @Server()
  async increment(user: any) {
    this.count++;
  }

  @Client()
  showAlert(msg: string) {
    // This would be implemented on the client
  }

  render(): TemplateResult {
    const strings = [`Count: ${this.count}, Message: ${this.message}`];
    return {
      strings,
      values: [],
      getHTML: () => strings.join(''),
    } as unknown as TemplateResult;
  }
}

describe('Cossack Core: Server-Side', () => {
  let component: TestComponent;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
    component = new TestComponent();
  });

  it('should throw an error if bootstrap is called without context', async () => {
    await expect(component.bootstrap()).rejects.toThrow(
      '[Cossack] Context must be provided during bootstrap on the server.'
    );
  });

  it('should initialize correctly with context', async () => {
    const mockContext = { req: { param: vi.fn() } } as unknown as Context;
    
    await component.bootstrap({ context: mockContext });

    expect((component as any).c).toEqual(mockContext);
  });

  it('should initialize state with default values', async () => {
      const mockContext = { req: { param: vi.fn() } } as unknown as Context;
      await component.bootstrap({ context: mockContext });
      expect(component.count).toBe(0);
      expect(component.message).toBe('initial');
  });

  it('should render HTML using renderToString', async () => {
    const mockContext = { req: { param: vi.fn() } } as unknown as Context;
    await component.bootstrap({ context: mockContext });
    
    const html = component._render();

    expect(renderToString).toHaveBeenCalled();
    expect(html).toContain('SSR:');
    expect(html).toContain('Count: 0');
  });

  it('getInitialState should return all state properties, params, and server methods', async () => {
    const mockParams: { [key: string]: string } = { id: '123' };
    const mockContext = { req: { param: (key?: string) => key ? mockParams[key] : mockParams } } as unknown as Context;
    await component.bootstrap({ context: mockContext });

    const initialState = component.getInitialState();

    expect(initialState).toHaveProperty('public');
    expect(initialState.public).toHaveProperty('count', 0);
    expect(initialState.public).toHaveProperty('message', 'initial');
    expect(initialState.metadata).toHaveProperty('params', mockParams);
    // Note: serverMethods is no longer included in serialized state for security.
    // Server methods are obtained directly from Reflect metadata on the client side.
  });

  it('should schedule a broadcast when a state property changes', async () => {
      const mockContext = { req: { param: vi.fn() } } as unknown as Context;
      const mockRuntime = { broadcastState: vi.fn(), persistState: vi.fn() };
      await component.bootstrap({ context: mockContext });
      (component as any)._runtime = mockRuntime;
  
      component.count = 5;
  
      // Wait for the microtask queue to be processed
      await new Promise(resolve => queueMicrotask(resolve));
  
      expect(mockRuntime.broadcastState).toHaveBeenCalledWith({ count: 5 });
  });

  it('propagates a named serialization error for an invalid server$ result', async () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      component.__serverResource('users', async () => circular, { initial: {} });

      await expect(Promise.all(component.__serverResourcePending())).rejects.toThrow(
          '[Cossack server$:users] result is not transport-safe: circular dependency',
      );
  });
});
