import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupScrollReveal } from '../src/client/scroll-reveal';

/**
 * setupScrollReveal is DOM-based; the framework unit tests run in a node env,
 * so we stub the minimum DOM surface (document, window, the two observers, and
 * a fake Element) instead of pulling in jsdom/happy-dom.
 */

class FakeElement {
  tag: string;
  nodeType = 1;
  classes = new Set<string>();
  children: FakeElement[] = [];
  matchesSelector = false;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  get classList() {
    return {
      add: (c: string) => this.classes.add(c),
      remove: (c: string) => this.classes.delete(c),
      contains: (c: string) => this.classes.has(c),
    };
  }
  matches(sel: string) {
    return this.matchesSelector;
  }
  querySelectorAll(sel: string): FakeElement[] {
    return this.children.filter((c) => c.matchesSelector);
  }
  forEach = (cb: (el: FakeElement) => void) => this.children.forEach(cb);
}

function makeStub() {
  const ioInstances: any[] = [];
  const moInstances: any[] = [];

  const IntersectionObserver = vi.fn(function (this: any, cb: any) {
    this.cb = cb;
    this.observe = vi.fn();
    this.unobserve = vi.fn();
    this.disconnect = vi.fn();
    ioInstances.push(this);
  });
  const MutationObserver = vi.fn(function (this: any, cb: any) {
    this.cb = cb;
    this.observe = vi.fn();
    this.disconnect = vi.fn();
    moInstances.push(this);
  });

  const listeners: Record<string, (...a: any[]) => void> = {};
  const document = {
    body: new FakeElement('body'),
    querySelectorAll: vi.fn(() => [] as any),
    addEventListener: vi.fn((ev: string, cb: any) => {
      listeners[ev] = cb;
    }),
    removeEventListener: vi.fn((ev: string) => {
      delete listeners[ev];
    }),
  };

  return { IntersectionObserver, MutationObserver, document, listeners, ioInstances, moInstances };
}

let stub: ReturnType<typeof makeStub>;
let realWindow: any;
let realDoc: any;

beforeEach(() => {
  stub = makeStub();
  realWindow = (globalThis as any).window;
  realDoc = (globalThis as any).document;
  (globalThis as any).window = {};
  (globalThis as any).document = stub.document;
  (globalThis as any).IntersectionObserver = stub.IntersectionObserver;
  (globalThis as any).MutationObserver = stub.MutationObserver;
});

afterEach(() => {
  (globalThis as any).window = realWindow;
  (globalThis as any).document = realDoc;
});

describe('setupScrollReveal', () => {
  it('observes existing elements on setup', () => {
    const existing = new FakeElement('div');
    stub.document.querySelectorAll.mockReturnValue([existing] as any);

    setupScrollReveal();

    expect(stub.ioInstances).toHaveLength(1);
    expect(stub.ioInstances[0].observe).toHaveBeenCalledWith(existing);
  });

  it('reveals elements and unobserves them by default (once)', () => {
    const el = new FakeElement('div');
    stub.document.querySelectorAll.mockReturnValue([el] as any);
    setupScrollReveal();

    // Simulate scrolling into view.
    stub.ioInstances[0].cb([{ isIntersecting: true, target: el }]);

    expect(el.classes.has('revealed')).toBe(true);
    expect(stub.ioInstances[0].unobserve).toHaveBeenCalledWith(el);
  });

  it('observes dynamically-added nodes via MutationObserver', () => {
    setupScrollReveal();

    const added = new FakeElement('div');
    added.matchesSelector = true; // matches the `.scroll-reveal` selector

    // Simulate a DOM mutation adding a new matching node.
    stub.moInstances[0].cb([{ addedNodes: [added] }]);

    expect(stub.ioInstances[0].observe).toHaveBeenCalledWith(added);
  });

  it('cleanup disconnects both observers', () => {
    const cleanup = setupScrollReveal();
    cleanup();

    expect(stub.ioInstances[0].disconnect).toHaveBeenCalled();
    expect(stub.moInstances[0].disconnect).toHaveBeenCalled();
  });

  it('is a no-op without a DOM (SSR)', () => {
    (globalThis as any).window = undefined;
    const cleanup = setupScrollReveal();
    expect(typeof cleanup).toBe('function');
    expect(stub.ioInstances).toHaveLength(0);
  });
});
