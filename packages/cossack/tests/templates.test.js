import { describe, expect, it } from 'vitest';
import { loadStub } from '../src/templates/load-stub.js';

describe('template catalog', () => {
  it('loads stubs and substitutes placeholders', () => {
    expect(loadStub('component.ts.stub', { className: 'Example', propsName: 'ExampleProps' }))
      .toContain('class Example');
  });
});
