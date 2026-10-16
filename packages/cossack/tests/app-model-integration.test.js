import { beforeAll, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { appModelSchema, validateAppModel } from '@cossackframework/core/app-model';
import { specsCommand } from '../src/commands/specs.js';
import { buildEffectiveRouteModel } from '../src/scan-routes.js';

// The framework package's own application is the fixture.
const framework = fileURLToPath(new URL('../../framework', import.meta.url));
let model;

const nodes = function* walk(list) {
  for (const node of list) {
    yield node;
    if (node.kind === 'control') for (const branch of node.branches) yield* walk(branch.nodes);
    if (node.kind === 'element' || node.kind === 'component') yield* walk(node.children);
  }
};
const classNamed = (name) => model.classes.find(item => item.name === name);

beforeAll(async () => {
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(await specsCommand([], { cwd: framework, flags: { json: true } })).toBe(0);
    const result = JSON.parse(output.mock.calls[0][0]);
    expect(result).toMatchObject({ schemaVersion: 1, command: 'specs', ok: true });
    model = result.data;
  } finally {
    output.mockRestore();
  }
}, 120_000);

it('validates against the schema in core', () => {
  expect(validateAppModel(model)).toEqual({ valid: true, errors: [] });
  expect(model).toMatchObject({ schemaVersion: 1, generator: { name: 'cossack' } });
});

it('covers every discovered route and layout', async () => {
  const effective = await buildEffectiveRouteModel(framework, {});
  expect(model.routes.map(route => route.path).sort()).toEqual(effective.pages.map(page => page.route).sort());
  expect(model.routes.find(route => route.path === '/hello/:name')).toMatchObject({ kind: 'page', params: ['name'], file: 'src/pages/hello/[name]/index.ts' });
  expect(model.layouts.map(layout => layout.file)).toContain('src/pages/layout.ts');
  for (const route of model.routes.filter(item => item.kind === 'page' && item.className)) {
    expect(model.classes.find(item => item.name === route.className && item.location.file === route.file), route.path).toMatchObject({ kind: 'page' });
  }
});

it('describes classes, decorators, state, methods, props, resources and comments', () => {
  const tracker = classNamed('TaskTrackerDemo');
  expect(tracker).toMatchObject({ kind: 'page', exported: true, extends: 'Cossack', decorators: [{ name: 'Page', arguments: [{ transport: 'http' }] }] });
  expect(tracker.comment).toMatch(/^TaskTrackerDemo — demonstrates/);
  expect(tracker.state).toContainEqual(expect.objectContaining({ name: 'name', decorator: 'State', type: 'string', initial: "'World'" }));
  expect(tracker.state).toContainEqual(expect.objectContaining({ name: 'form', decorator: 'Store', type: '{ email: string; password: string; }' }));
  expect(tracker.methods).toContainEqual(expect.objectContaining({ name: 'trackedNameTask', kind: 'task',
    decorators: [{ name: 'Task', arguments: [{ track: ['name'] }] }], comment: expect.stringContaining("track: ['name']") }));
  expect(tracker.methods).toContainEqual(expect.objectContaining({ name: 'head', kind: 'lifecycle', returnType: 'HeadValue' }));

  const servers = model.classes.flatMap(item => item.methods.filter(method => method.kind === 'server'));
  expect(servers.length).toBeGreaterThan(5);
  expect(servers.every(method => method.decorators.some(decorator => decorator.name === 'Server' || decorator.name === 'ServerTask'))).toBe(true);
  expect(model.classes.flatMap(item => item.methods).some(method => method.kind === 'client')).toBe(true);

  expect(classNamed('StyledCard').props).toEqual({ type: 'StyledCardProps', members: [
    { name: 'label', type: 'string', optional: false, comment: null },
    { name: 'featured', type: 'boolean | undefined', optional: true, comment: null },
  ] });
  expect(classNamed('ServerFunctionsExample').resources).toContainEqual(expect.objectContaining({
    name: 'serverInfo', type: '{ runtime: string; resolvedAt: string; }' }));
  expect(model.classes.flatMap(item => item.services).length).toBeGreaterThan(0);
});

it('builds UI trees with elements, components, controls, text and typed expressions', () => {
  const tasks = model.classes.find(item => item.kind === 'page' && item.location.file === 'src/pages/tasks/index.ts');
  const tree = [...nodes(tasks.render)];
  const list = tree.find(node => node.kind === 'control' && node.control === 'map');
  expect(list).toMatchObject({ source: 'this.tasks', parameters: ['task'], branches: [{ label: 'item' }] });
  expect(tree).toContainEqual(expect.objectContaining({ kind: 'element', tag: 'ul', attributes: [{ name: 'class', kind: 'attribute', value: 'list-none p-0' }] }));
  expect(tree).toContainEqual(expect.objectContaining({ kind: 'component', class: 'Button',
    props: expect.arrayContaining([expect.objectContaining({ name: '@click', kind: 'event' })]) }));
  expect(tree).toContainEqual(expect.objectContaining({ kind: 'expression', source: 'task.text', type: 'string' }));
  expect(tree).toContainEqual({ kind: 'text', text: 'Tasks' });

  const all = model.classes.flatMap(item => [...nodes(item.render ?? [])]);
  const controls = new Set(all.filter(node => node.kind === 'control').map(node => node.control));
  for (const control of ['conditional', 'or', 'map', 'when', 'choose', 'repeat']) expect(controls, control).toContain(control);
  expect(all.find(node => node.kind === 'control' && node.control === 'repeat').key).toBeTypeOf('string');
});

it('prints the JSON Schema', async () => {
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(await specsCommand([], { cwd: framework, flags: { schema: true } })).toBe(0);
    expect(JSON.parse(output.mock.calls[0][0])).toEqual(JSON.parse(JSON.stringify(appModelSchema)));
  } finally {
    output.mockRestore();
  }
});
