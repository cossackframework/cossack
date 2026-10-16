import { describe, expect, it } from 'vitest';
import { APP_MODEL_SCHEMA_VERSION, appModelSchema, validateAppModel, type AppModel } from '../src/app-model';

const location = { file: 'src/pages/index.ts', line: 1, column: 1 };
const model: AppModel = {
  schemaVersion: APP_MODEL_SCHEMA_VERSION,
  generator: { name: 'cossack', version: '0.9.0' },
  routes: [{ path: '/users/:id', kind: 'page', file: 'src/pages/users/[id].ts', className: 'User', params: ['id'], layouts: ['src/pages/layout.ts'], transport: 'http', stateful: null, ssg: false }],
  layouts: [{ file: 'src/pages/layout.ts', scope: '/src/pages', className: 'Layout', services: [] }],
  classes: [{
    name: 'User', kind: 'page', location, exported: true, extends: 'Cossack',
    decorators: [{ name: 'Page', arguments: [{ transport: 'http', handler: { $expression: 'handle' } }] }],
    comment: 'A user profile.', props: { type: 'UserProps', members: [{ name: 'id', type: 'string', optional: false, comment: null }] },
    state: [{ name: 'name', decorator: 'State', type: 'string', initial: "''", comment: null, location }],
    methods: [{ name: 'save', kind: 'server', decorators: [{ name: 'Server', arguments: [] }], parameters: [{ name: 'name', type: 'string', optional: false }],
      returnType: 'Promise<void>', async: true, static: false, comment: null, location }],
    resources: [{ name: 'profile', type: '{ name: string; }', source: '() => load()', comment: null, location }],
    services: [{ name: 'users', service: 'UserService' }],
    render: [{
      kind: 'element', tag: 'main', namespace: 'html', location,
      attributes: [{ name: 'class', kind: 'attribute', value: 'page' }, { name: 'title', kind: 'attribute', parts: ['User ', { source: 'this.name', type: 'string' }] }],
      children: [
        { kind: 'component', class: 'Card', props: [{ name: 'hoverable', kind: 'attribute', value: null }], children: [{ kind: 'text', text: 'Hi' }], location },
        { kind: 'control', control: 'repeat', source: 'this.items', parameters: ['item'], key: 'item => item.id', location,
          branches: [{ label: 'item', nodes: [{ kind: 'expression', source: 'item.name', type: 'string', location }] }] },
      ],
    }],
  }],
};

describe('app model schema', () => {
  it('accepts a complete document', () => {
    expect(validateAppModel(model)).toEqual({ valid: true, errors: [] });
    expect(appModelSchema.$defs.node.oneOf).toHaveLength(5);
  });

  it('reports the path and reason of each failure', () => {
    const broken = structuredClone(model) as any;
    broken.schemaVersion = 2;
    delete broken.routes[0].path;
    broken.classes[0].kind = 'widget';
    broken.classes[0].render[0].children[1].branches[0].nodes[0].kind = 'mystery';
    broken.classes[0].extra = true;
    const { valid, errors } = validateAppModel(broken);
    expect(valid).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([
      '/schemaVersion must be 1',
      '/routes/0/path is required',
      '/classes/0/kind must be one of page, layout, component, service, class',
      '/classes/0/render/0/children/1/branches/0/nodes/0 matches no allowed shape',
      '/classes/0/extra is not allowed',
    ]));
  });
});
