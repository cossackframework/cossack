import { describe, expect, it } from 'vitest';
import * as catalog from '../src/templates.js';
import { loadStub } from '../src/templates/load-stub.js';

describe('template catalog', () => {
  it('keeps representative compatibility exports', () => {
    for (const name of ['pageTemplate', 'userModelTemplate', 'langJsonTemplate', 'UI_COMPONENTS']) {
      expect(catalog[name]).toBeDefined();
    }
  });

  it('loads stubs and substitutes placeholders', () => {
    expect(loadStub('component.ts.stub', { className: 'Example', propsName: 'ExampleProps' }))
      .toContain('class Example');
  });
});
