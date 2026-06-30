import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Page, State, Server, Client, PageOptions, createTypedDecorators, Ref, Debounce, Throttle } from '../src/shared/decorators';
import * as environment from '../src/shared/environment';

vi.mock('../src/shared/environment');

describe('Decorators', () => {
  describe('@Ref', () => {
    it('should initialize a property as a RefObject', () => {
      class TestComponent {
        @Ref()
        declare inputRef: any;
      }
      const instance = new TestComponent();
      expect(instance.inputRef).toHaveProperty('value');
      expect(instance.inputRef.value).toBeUndefined();
    });

    it('should maintain the value across accesses', () => {
      class TestComponent {
        @Ref()
        declare inputRef: any;
      }
      const instance = new TestComponent();
      const ref1 = instance.inputRef;
      const ref2 = instance.inputRef;
      expect(ref1).toBe(ref2);
      
      instance.inputRef.value = 'test';
      expect(instance.inputRef.value).toBe('test');
    });

    it('should allow setting the ref directly (though unusual)', () => {
      class TestComponent {
        @Ref()
        declare inputRef: any;
      }
      const instance = new TestComponent();
      const newRef = { value: 'custom' };
      instance.inputRef = newRef;
      expect(instance.inputRef).toBe(newRef);
      expect(instance.inputRef.value).toBe('custom');
    });
  });

  describe('@Page', () => {
    it('should attach default page options if none are provided', () => {
      @Page()
      class TestPage {}
      const options = Reflect.getMetadata('page:options', TestPage);
      expect(options).toEqual({ channels: ['global'], transport: 'http' });
    });

    it('should attach provided page options', () => {
      const pageOptions: PageOptions = {
        middlewares: [async (c, next) => next()],
        channels: ['news', 'sports'],
      };
      @Page(pageOptions)
      class TestPage {}
      const options = Reflect.getMetadata('page:options', TestPage);
      expect(options.middlewares).toHaveLength(1);
      // It should also automatically add 'global'
      expect(options.channels).toEqual(['global', 'news', 'sports']);
      expect(options.transport).toBe('http');
    });

    it('should not add "global" channel if it already exists', () => {
        const pageOptions: PageOptions = {
          channels: ['global', 'news'],
        };
        @Page(pageOptions)
        class TestPage {}
        const options = Reflect.getMetadata('page:options', TestPage);
        expect(options.channels).toEqual(['global', 'news']);
        expect(options.transport).toBe('http');
      });
  });

  describe('@State', () => {
    it('should define state metadata with a default channel', () => {
      class TestComponent {
        @State()
        count = 0;
      }
      const stateMeta = Reflect.getMetadata('cossack:state', TestComponent);
      expect(stateMeta).toEqual({
        count: { channel: 'global', provider: 'page' },
      });
    });

    it('should define state metadata with a specified channel', () => {
      class TestComponent {
        @State({ channel: 'private' })
        message = 'hello';
      }
      const stateMeta = Reflect.getMetadata('cossack:state', TestComponent);
      expect(stateMeta).toEqual({
        message: { channel: 'private', provider: 'page' },
      });
    });

    it('should accumulate metadata from multiple @State decorators', () => {
        class TestComponent {
          @State()
          counter = 0;
  
          @State({ channel: 'special' })
          status = 'idle';
        }
        const stateMeta = Reflect.getMetadata('cossack:state', TestComponent);
        expect(stateMeta).toEqual({
          counter: { channel: 'global', provider: 'page' },
          status: { channel: 'special', provider: 'page' },
        });
      });
  });

  describe('@Server', () => {
    it('should define server method metadata with a default channel', () => {
      class TestComponent {
        @Server()
        doSomething() {}
      }
      const serverMeta = Reflect.getMetadata('cossack:server-methods', TestComponent);
      expect(serverMeta).toEqual({
        doSomething: { channel: 'global', provider: 'page' },
      });
    });

    it('should define server method metadata with a specified channel', () => {
      class TestComponent {
        @Server({ channel: 'admin' })
        doAdminTask() {}
      }
      const serverMeta = Reflect.getMetadata('cossack:server-methods', TestComponent);
      expect(serverMeta).toEqual({
        doAdminTask: { channel: 'admin', provider: 'page' },
      });
    });
  });

  describe('@Client', () => {
    describe('when on the server (isServer = true)', () => {
        beforeEach(() => {
            vi.spyOn(environment, 'isServer', 'get').mockReturnValue(true);
        });

        it('should replace the method with a noop function', () => {
            class TestComponent {
                @Client()
                showAlert() {
                    return 'real implementation';
                }
            }
            const instance = new TestComponent();
            expect(instance.showAlert()).toBe(undefined);
        });

        it('should define client method metadata with channel info', () => {
            class TestComponent {
                @Client({ channel: 'notifications' })
                showAlert() {}
            }
            const clientMeta = Reflect.getMetadata('cossack:client-methods', TestComponent);
            expect(clientMeta).toEqual({
                showAlert: { channel: 'notifications' },
            });
        });
    });

    describe('when on the client (isServer = false)', () => {
        beforeEach(() => {
            vi.spyOn(environment, 'isServer', 'get').mockReturnValue(false);
        });

        it('should NOT replace the method', () => {
            class TestComponent {
                @Client()
                showAlert() {
                    return 'real implementation';
                }
            }
            const instance = new TestComponent();
            expect(instance.showAlert()).toBe('real implementation');
        });

        it('should define client method metadata with a boolean flag', () => {
            class TestComponent {
                @Client()
                showAlert() {}
            }
            const clientMeta = Reflect.getMetadata('cossack:client-methods', TestComponent);
            expect(clientMeta).toEqual({
                showAlert: true,
            });
        });
    });
  });

  describe('@Debounce', () => {
    it('should store debounce metadata mapping method name to ms', () => {
      class TestComponent {
        @Debounce(500)
        search() {}
      }
      const meta = Reflect.getMetadata('cossack:debounce', TestComponent);
      expect(meta).toEqual({ search: 500 });
    });

    it('should accumulate metadata for multiple @Debounce methods', () => {
      class TestComponent {
        @Debounce(300)
        search() {}

        @Debounce(1000)
        save() {}
      }
      const meta = Reflect.getMetadata('cossack:debounce', TestComponent);
      expect(meta).toEqual({ search: 300, save: 1000 });
    });

    it('does not stub or wrap the method body at decoration time', () => {
      // @Debounce is a neutral modifier: it only records metadata and leaves the
      // method callable as-is. Wrapping happens later, during _frameworkMount().
      class TestComponent {
        @Debounce(500)
        handler() {
          return 'real implementation';
        }
      }
      const instance = new TestComponent();
      expect((instance as any).handler()).toBe('real implementation');
      expect(Reflect.getMetadata('cossack:debounce', TestComponent)).toEqual({ handler: 500 });
    });
  });

  describe('@Throttle', () => {
    it('should store throttle metadata mapping method name to ms', () => {
      class TestComponent {
        @Throttle(200)
        onScroll() {}
      }
      const meta = Reflect.getMetadata('cossack:throttle', TestComponent);
      expect(meta).toEqual({ onScroll: 200 });
    });

    it('uses a separate metadata key from @Debounce', () => {
      class TestComponent {
        @Debounce(500)
        search() {}

        @Throttle(200)
        onScroll() {}
      }
      expect(Reflect.getMetadata('cossack:debounce', TestComponent)).toEqual({ search: 500 });
      expect(Reflect.getMetadata('cossack:throttle', TestComponent)).toEqual({ onScroll: 200 });
    });
  });

  describe('createTypedDecorators', () => {
    it('should return an object with State and Server properties', () => {
        interface MyComponentOptions {
            Channels: 'channel1' | 'channel2';
        }
        const typedDecorators = createTypedDecorators<MyComponentOptions>();
        expect(typedDecorators).toHaveProperty('State');
        expect(typedDecorators).toHaveProperty('Server');
    });

    it('should return decorators that function correctly', () => {
        const { State: TypedState } = createTypedDecorators();
        class TestComponent {
            @TypedState({ channel: 'test' })
            message = 'hello';
        }
        const stateMeta = Reflect.getMetadata('cossack:state', TestComponent);
        expect(stateMeta).toEqual({
            message: { channel: 'test', provider: 'page' },
        });
    });
  });
});
