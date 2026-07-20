import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Service, State, Server, Shared } from '@cossackframework/core';

describe('CounterService', () => {
  @Service()
  class CounterService {
    @State() count = 0;

    @Server()
    increment() { this.count++; }

    @Server()
    decrement() { this.count--; }

    @Shared()
    formatCount(): string { return `Count: ${this.count}`; }
  }

  it('should have @Service metadata', () => {
    expect(Reflect.getMetadata('cossack:service', CounterService)).toEqual({ scope: 'singleton' });
  });

  it('should have @State metadata for count', () => {
    const state = Reflect.getMetadata('cossack:state', CounterService);
    expect(state).toHaveProperty('count');
  });

  it('should have @Server metadata for increment and decrement', () => {
    const serverMethods = Reflect.getMetadata('cossack:server-methods', CounterService);
    expect(serverMethods).toHaveProperty('increment');
    expect(serverMethods).toHaveProperty('decrement');
  });

  it('should have @Shared metadata for formatCount', () => {
    const serverMethods = Reflect.getMetadata('cossack:server-methods', CounterService);
    const clientMethods = Reflect.getMetadata('cossack:client-methods', CounterService);
    expect(Reflect.getMetadata('cossack:shared', CounterService.prototype, 'formatCount')).toBe(true);
    expect(serverMethods).not.toHaveProperty('formatCount');
    expect(clientMethods).toBeUndefined();
  });

  it('should increment count', () => {
    const service = new CounterService();
    service.increment();
    expect(service.count).toBe(1);
  });

  it('should decrement count', () => {
    const service = new CounterService();
    service.increment();
    service.decrement();
    expect(service.count).toBe(0);
  });

  it('should format count string', () => {
    const service = new CounterService();
    expect(service.formatCount()).toBe('Count: 0');
    service.increment();
    expect(service.formatCount()).toBe('Count: 1');
  });

  it('should handle negative counts', () => {
    const service = new CounterService();
    service.decrement();
    expect(service.count).toBe(-1);
    expect(service.formatCount()).toBe('Count: -1');
  });
});
