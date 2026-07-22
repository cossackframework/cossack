import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { Service, ServiceOptions } from '../src/shared/decorators';
import { DIContainer, isService, getServiceMetadata, createInstance, getContainer, resetContainer } from '../src/shared/container';

describe('Dependency Injection', () => {
  beforeEach(() => {
    resetContainer();
  });

  describe('@Service() decorator', () => {
    it('should store service metadata with default singleton scope', () => {
      @Service()
      class TestService {}

      expect(isService(TestService)).toBe(true);
      const meta = getServiceMetadata(TestService);
      expect(meta).toEqual({ scope: 'singleton' });
    });

    it('should store service metadata with transient scope', () => {
      @Service({ scope: 'transient' })
      class TransientService {}

      const meta = getServiceMetadata(TransientService);
      expect(meta).toEqual({ scope: 'transient' });
    });

    it('should return false for non-service classes', () => {
      class NotAService {}
      expect(isService(NotAService)).toBe(false);
    });
  });

  describe('DIContainer', () => {
    it('should resolve a singleton service', () => {
      @Service()
      class SingletonService {
        value = 42;
      }

      const container = new DIContainer();
      const instance1 = container.resolve(SingletonService);
      const instance2 = container.resolve(SingletonService);

      expect(instance1).toBe(instance2);
      expect(instance1.value).toBe(42);
    });

    it('should resolve different instances for transient services', () => {
      @Service({ scope: 'transient' })
      class TransientService {
        value = Math.random();
      }

      const container = new DIContainer();
      const instance1 = container.resolve(TransientService);
      const instance2 = container.resolve(TransientService);

      expect(instance1).not.toBe(instance2);
    });

    it('should resolve constructor dependencies', () => {
      @Service()
      class LoggerService {
        logs: string[] = [];
        log(msg: string) { this.logs.push(msg); }
      }

      @Service()
      class UserService {
        logger: LoggerService;
        constructor(logger: LoggerService) {
          this.logger = logger;
        }
        doWork() { this.logger.log('working'); }
      }

      // Manually set design:paramtypes (normally emitted by TypeScript emitDecoratorMetadata)
      Reflect.defineMetadata('design:paramtypes', [LoggerService], UserService);

      const container = new DIContainer();
      const userSvc = container.resolve(UserService);

      expect(userSvc.logger).toBeInstanceOf(LoggerService);
      userSvc.doWork();
      expect(userSvc.logger.logs).toEqual(['working']);
    });

    it('should share singleton dependencies across services', () => {
      @Service()
      class SharedService {
        count = 0;
      }

      @Service()
      class ServiceA {
        shared: SharedService;
        constructor(shared: SharedService) {
          this.shared = shared;
        }
      }

      @Service()
      class ServiceB {
        shared: SharedService;
        constructor(shared: SharedService) {
          this.shared = shared;
        }
      }

      // Manually set design:paramtypes
      Reflect.defineMetadata('design:paramtypes', [SharedService], ServiceA);
      Reflect.defineMetadata('design:paramtypes', [SharedService], ServiceB);

      const container = new DIContainer();
      const a = container.resolve(ServiceA);
      const b = container.resolve(ServiceB);

      expect(a.shared).toBe(b.shared);
      a.shared.count = 99;
      expect(b.shared.count).toBe(99);
    });

    it('should detect circular dependencies', () => {
      @Service()
      class ServiceA {
        constructor(public b: any) {}
      }

      @Service()
      class ServiceB {
        constructor(public a: ServiceA) {}
      }

      // Manually set design:paramtypes to create circular reference
      Reflect.defineMetadata('design:paramtypes', [ServiceB], ServiceA);
      Reflect.defineMetadata('design:paramtypes', [ServiceA], ServiceB);

      const container = new DIContainer();
      expect(() => container.resolve(ServiceA)).toThrow('Circular dependency detected');
    });

    it('should throw error for non-service classes', () => {
      class NotAService {}

      const container = new DIContainer();
      expect(() => container.resolve(NotAService)).toThrow('is not decorated with @Service()');
    });

    it('should clear all singletons', () => {
      @Service()
      class MyService {}

      const container = new DIContainer();
      const instance1 = container.resolve(MyService);
      container.clear();
      const instance2 = container.resolve(MyService);

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('createInstance', () => {
    it('prepares injected properties only once when attaching a scope', () => {
      class ScopedConsumer {
        prepareCalls = 0;
        scopeCalls = 0;
        _prepareInjectedServices() { this.prepareCalls++; }
        _setServiceScope() {
          this.scopeCalls++;
          this._prepareInjectedServices();
        }
      }

      const instance = createInstance(ScopedConsumer, { serviceScope: {} as any });
      expect(instance.scopeCalls).toBe(1);
      expect(instance.prepareCalls).toBe(1);
    });

    it('still prepares unscoped instances for lazy missing-scope errors', () => {
      class UnscopedConsumer {
        prepareCalls = 0;
        _prepareInjectedServices() { this.prepareCalls++; }
      }

      expect(createInstance(UnscopedConsumer).prepareCalls).toBe(1);
    });

    it('should create instance with no dependencies', () => {
      @Service()
      class SimpleService {
        value = 'hello';
      }

      const instance = createInstance(SimpleService);
      expect(instance).toBeInstanceOf(SimpleService);
      expect(instance.value).toBe('hello');
    });

    it('should inject service dependencies', () => {
      @Service()
      class DependencyService {
        name = 'dep';
      }

      @Service()
      class ConsumerService {
        dep: DependencyService;
        constructor(dep: DependencyService) {
          this.dep = dep;
        }
      }

      // Manually set design:paramtypes
      Reflect.defineMetadata('design:paramtypes', [DependencyService], ConsumerService);

      const instance = createInstance(ConsumerService);
      expect(instance.dep).toBeInstanceOf(DependencyService);
      expect(instance.dep.name).toBe('dep');
    });

    it('should create instance of non-service class without dependencies', () => {
      class PlainClass {
        value = 42;
      }

      const instance = createInstance(PlainClass);
      expect(instance).toBeInstanceOf(PlainClass);
      expect(instance.value).toBe(42);
    });

    it('should share singletons across createInstance calls', () => {
      @Service()
      class SingletonSvc {
        id = Math.random();
      }

      @Service()
      class SvcA {
        singleton: SingletonSvc;
        constructor(singleton: SingletonSvc) {
          this.singleton = singleton;
        }
      }

      @Service()
      class SvcB {
        singleton: SingletonSvc;
        constructor(singleton: SingletonSvc) {
          this.singleton = singleton;
        }
      }

      // Manually set design:paramtypes
      Reflect.defineMetadata('design:paramtypes', [SingletonSvc], SvcA);
      Reflect.defineMetadata('design:paramtypes', [SingletonSvc], SvcB);

      const a = createInstance(SvcA);
      const b = createInstance(SvcB);
      expect(a.singleton).toBe(b.singleton);
    });
  });

  describe('getContainer / resetContainer', () => {
    it('should return the same container instance', () => {
      const c1 = getContainer();
      const c2 = getContainer();
      expect(c1).toBe(c2);
    });

    it('should create a new container after reset', () => {
      const c1 = getContainer();
      resetContainer();
      const c2 = getContainer();
      expect(c1).not.toBe(c2);
    });
  });
});
