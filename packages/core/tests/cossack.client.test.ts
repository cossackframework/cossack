// tests/cossack.client.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock the environment to be client-side BEFORE anything else is imported
vi.mock('../src/shared/environment', () => ({
  isServer: false,
}));

import { Cossack } from '../src/shared/cossack';
import { State, Server, Client } from '../src/shared/decorators';
import * as renderer from '@cossackframework/renderer';
import type { TemplateResult } from '@cossackframework/renderer';

// Mock the renderer sub-imports
vi.mock('@cossackframework/renderer/server', () => ({
  renderToString: vi.fn(),
}));
vi.mock('@cossackframework/renderer', () => ({
  render: vi.fn(),
}));

// A concrete implementation for testing. This is now a top-level declaration.
class TestComponent extends Cossack<{}> {
  @State() count = 0;
  @State({ channel: 'private' }) message = 'initial';

  @Server()
  async increment(user?: any) {
    // This is the server-side implementation, which will be proxied on the client
    this.count++;
  }

  @Client()
  showAlert(msg: string) {
    // This would be implemented on the client
  }

  template(): TemplateResult {
    const strings = [`Count: ${this.count}, Message: ${this.message}`];
    return {
      strings,
      values: [],
      getHTML: () => strings.join(''),
    } as unknown as TemplateResult;
  }
}

describe('Cossack Core: Client-Side', () => {
  let component: TestComponent;

  const mockInitialState = {
      count: 10,
      message: 'from server',
      params: { name: 'cossack' },
      serverMethods: [{ name: 'increment', channel: 'global' }],
      componentId: 'test-comp',
      channels: ['global', 'private'],
  };

  beforeEach(() => {
      vi.clearAllMocks();
      
      // Mock global window and WebSocket
      global.window = {
          __INITIAL_STATE__: mockInitialState,
          location: { host: 'localhost' },
      } as any;
      global.WebSocket = vi.fn(() => ({
          send: vi.fn(),
          close: vi.fn(),
      })) as any;

      component = new TestComponent();
  });

  afterEach(() => {
      // Clean up global mocks
      // @ts-ignore
      delete global.window;
      // @ts-ignore
      delete global.WebSocket;
  });

  it('should initialize state from window.__INITIAL_STATE__', async () => {
      await component.bootstrap();
      expect(component.count).toBe(10);
      expect(component.message).toBe('from server');
  });

  it('should setup context with params from initial state', async () => {
      await component.bootstrap();
      expect((component as any).c.req.param('name')).toBe('cossack');
      expect((component as any).c.req.param()).toEqual({ name: 'cossack' });
  });

  it('should connect to WebSocket for each channel', async () => {
      await component.bootstrap();
      expect(global.WebSocket).toHaveBeenCalledTimes(2);
      expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost/ws/test-comp/global?name=cossack');
      expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost/ws/test-comp/private?name=cossack');
  });

  it('should proxy server methods to send WebSocket messages', async () => {
      await component.bootstrap();
      const wsInstance = (global.WebSocket as any).mock.results[0].value;
      
      // This is now a proxied method
      await component.increment();

      expect(wsInstance.send).toHaveBeenCalledWith(JSON.stringify({
          type: 'action',
          action: 'increment',
          payload: [],
      }));
      // It should also update the loading state
      expect(component.loading['increment']).toBe(true);
  });

  it('should render the template into the container if provided', async () => {
      const container = { innerHTML: '' }; // A mock DOM element
      await component.bootstrap({ container: container as any });
      expect(renderer.render).toHaveBeenCalled();
      expect(renderer.render).toHaveBeenCalledWith(expect.anything(), container);
  });

  it('should replace server methods with a proxy and not execute the original implementation', async () => {
    await component.bootstrap();
    
    // The initial count from the server is 10
    expect(component.count).toBe(10);

    // Call the proxied server method
    await component.increment();

    // The count should NOT have changed on the client, proving the original implementation was not called
    expect(component.count).toBe(10);

    // But the loading state should have been updated by the proxy
    expect(component.loading['increment']).toBe(true);
  });
});
