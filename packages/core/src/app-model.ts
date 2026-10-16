/**
 * The app model: a versioned JSON description of a Cossack application that
 * `cossack specs` emits. It lists routes, classes (decorators, props, state,
 * methods, resources, injected services, comments) and one UI tree per
 * `render()`. Generators, documentation and other tools read it instead of
 * parsing TypeScript. Files are project-relative with forward slashes.
 */

export const APP_MODEL_SCHEMA_VERSION = 1;

/** A JSON value, as in decorator arguments. Non-literal code is `{ $expression }`. */
export type AppModelJson = string | number | boolean | null | AppModelJson[] | { [key: string]: AppModelJson };

export interface AppModelLocation {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

export interface AppModel {
  schemaVersion: typeof APP_MODEL_SCHEMA_VERSION;
  generator: { name: 'cossack'; version: string };
  routes: AppModelRoute[];
  layouts: AppModelLayout[];
  classes: AppModelClass[];
}

export interface AppModelRoute {
  /** URL pattern, such as `/users/:id`. */
  path: string;
  /** `page`, `api`, `error` or `not-found`, as route discovery reports it. */
  kind: string;
  file: string;
  /** The default-exported class, when it resolves to a local class. */
  className: string | null;
  params: string[];
  /** Layout files from the outermost. */
  layouts: string[];
  transport: string | null;
  stateful: boolean | null;
  ssg: boolean | null;
}

export interface AppModelLayout {
  file: string;
  /** The pages directory the layout wraps, such as `/src/pages/(auth)`. */
  scope: string;
  className: string | null;
  /** Scoped services the layout declares. */
  services: string[];
}

export type AppModelClassKind = 'page' | 'layout' | 'component' | 'service' | 'class';

export interface AppModelDecorator {
  name: string;
  arguments: AppModelJson[];
}

export interface AppModelClass {
  name: string;
  kind: AppModelClassKind;
  location: AppModelLocation;
  exported: boolean;
  /** The `extends` clause as written, or null. */
  extends: string | null;
  decorators: AppModelDecorator[];
  comment: string | null;
  /** The declared `props` type; members are those the project declares. */
  props: { type: string; members: AppModelMember[] } | null;
  state: AppModelState[];
  methods: AppModelMethod[];
  /** Fields that load server data with `server$()`. */
  resources: AppModelResource[];
  /** Fields with `@Inject(Service)`. */
  services: { name: string; service: string }[];
  /** The UI tree `render()` returns; null for classes without one. */
  render: AppModelNode[] | null;
}

export interface AppModelMember {
  name: string;
  type: string;
  optional: boolean;
  comment: string | null;
}

export interface AppModelState {
  name: string;
  /** `State`, `ClientState`, `Store` or `ClientStore`. */
  decorator: string;
  type: string;
  /** The initializer as written, or null. */
  initial: string | null;
  comment: string | null;
  location: AppModelLocation;
}

/** `task` is a `@Task` method; `@ServerTask` is server and `@ClientTask`/`@VisibleTask` client. */
export type AppModelMethodKind = 'server' | 'client' | 'shared' | 'computed' | 'task' | 'lifecycle' | 'method';

export interface AppModelMethod {
  name: string;
  kind: AppModelMethodKind;
  decorators: AppModelDecorator[];
  parameters: { name: string; type: string; optional: boolean }[];
  returnType: string;
  async: boolean;
  static: boolean;
  comment: string | null;
  location: AppModelLocation;
}

export interface AppModelResource {
  name: string;
  /** The value type the resource resolves to. */
  type: string;
  /** The loader as written. */
  source: string;
  comment: string | null;
  location: AppModelLocation;
}

export type AppModelAttributeKind = 'attribute' | 'property' | 'boolean' | 'event' | 'spread';

/** An expression in a template or render(), with its inferred type. */
export interface AppModelExpression {
  source: string;
  type: string;
}

export interface AppModelAttribute {
  /** As written, including a `.`, `?` or `@` prefix, or `...`. */
  name: string;
  kind: AppModelAttributeKind;
  /** Static text (character references kept), or null for a bare attribute. Absent when bound. */
  value?: string | null;
  /** The bound expression of a whole-value binding. */
  binding?: AppModelExpression;
  /** Static text and expressions of an interpolated value, in order. */
  parts?: (string | AppModelExpression)[];
}

export type AppModelNode = AppModelElementNode | AppModelComponentNode | AppModelControlNode | AppModelTextNode | AppModelExpressionNode;

export interface AppModelElementNode {
  kind: 'element';
  tag: string;
  namespace: 'html' | 'svg' | 'mathml';
  attributes: AppModelAttribute[];
  children: AppModelNode[];
  location: AppModelLocation;
}

/** A component tag, or a component() call with a literal class. */
export interface AppModelComponentNode {
  kind: 'component';
  /** The class expression as written. */
  class: string;
  props: AppModelAttribute[];
  children: AppModelNode[];
  location: AppModelLocation;
}

export type AppModelControl = 'conditional' | 'and' | 'or' | 'when' | 'choose' | 'repeat' | 'map' | 'returns';

/** Rendering that depends on data, detected syntactically. */
export interface AppModelControlNode {
  kind: 'control';
  control: AppModelControl;
  /** The condition, the chosen value or the list, as written; null for `returns`. */
  source: string | null;
  /** List item and index parameter names of `map` and `repeat`. */
  parameters?: string[];
  /** The key function of `repeat`, as written. */
  key?: string;
  branches: { label: string; nodes: AppModelNode[] }[];
  location: AppModelLocation;
}

export interface AppModelTextNode {
  kind: 'text';
  /** As written, without surrounding whitespace. */
  text: string;
}

export interface AppModelExpressionNode extends AppModelExpression {
  kind: 'expression';
  location: AppModelLocation;
}

// --- JSON Schema ---

type Schema = Record<string, unknown>;
const string = { type: 'string' } as const;
const nullable = (schema: Schema) => ({ anyOf: [schema, { type: 'null' }] });
const array = (items: Schema) => ({ type: 'array', items });
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const object = (properties: Record<string, Schema>, optional: string[] = []) => ({
  type: 'object', additionalProperties: false, properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
});

/** JSON Schema (2020-12) of the app model document. */
export const appModelSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://cossackframework.com/schemas/app-model-1.json',
  title: 'Cossack app model',
  ...object({
    schemaVersion: { const: APP_MODEL_SCHEMA_VERSION },
    generator: object({ name: { const: 'cossack' }, version: string }),
    routes: array(ref('route')),
    layouts: array(ref('layout')),
    classes: array(ref('class')),
  }),
  $defs: {
    json: { anyOf: [{ type: ['string', 'number', 'boolean', 'null'] }, array(ref('json')), { type: 'object', additionalProperties: ref('json') }] },
    location: object({ file: string, line: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 } }),
    route: object({
      path: string, kind: string, file: string, className: nullable(string), params: array(string), layouts: array(string),
      transport: nullable(string), stateful: nullable({ type: 'boolean' }), ssg: nullable({ type: 'boolean' }),
    }),
    layout: object({ file: string, scope: string, className: nullable(string), services: array(string) }),
    decorator: object({ name: string, arguments: array(ref('json')) }),
    member: object({ name: string, type: string, optional: { type: 'boolean' }, comment: nullable(string) }),
    class: object({
      name: string, kind: { enum: ['page', 'layout', 'component', 'service', 'class'] }, location: ref('location'),
      exported: { type: 'boolean' }, extends: nullable(string), decorators: array(ref('decorator')), comment: nullable(string),
      props: nullable(object({ type: string, members: array(ref('member')) })),
      state: array(object({ name: string, decorator: string, type: string, initial: nullable(string), comment: nullable(string), location: ref('location') })),
      methods: array(object({
        name: string, kind: { enum: ['server', 'client', 'shared', 'computed', 'task', 'lifecycle', 'method'] }, decorators: array(ref('decorator')),
        parameters: array(object({ name: string, type: string, optional: { type: 'boolean' } })), returnType: string,
        async: { type: 'boolean' }, static: { type: 'boolean' }, comment: nullable(string), location: ref('location'),
      })),
      resources: array(object({ name: string, type: string, source: string, comment: nullable(string), location: ref('location') })),
      services: array(object({ name: string, service: string })),
      render: nullable(array(ref('node'))),
    }),
    expression: object({ source: string, type: string }),
    attribute: object({
      name: string, kind: { enum: ['attribute', 'property', 'boolean', 'event', 'spread'] }, value: nullable(string),
      binding: ref('expression'), parts: array({ anyOf: [string, ref('expression')] }),
    }, ['value', 'binding', 'parts']),
    node: { oneOf: [ref('element'), ref('component'), ref('control'), ref('text'), ref('expressionNode')] },
    element: object({
      kind: { const: 'element' }, tag: string, namespace: { enum: ['html', 'svg', 'mathml'] }, attributes: array(ref('attribute')),
      children: array(ref('node')), location: ref('location'),
    }),
    component: object({ kind: { const: 'component' }, class: string, props: array(ref('attribute')), children: array(ref('node')), location: ref('location') }),
    control: object({
      kind: { const: 'control' }, control: { enum: ['conditional', 'and', 'or', 'when', 'choose', 'repeat', 'map', 'returns'] },
      source: nullable(string), parameters: array(string), key: string,
      branches: array(object({ label: string, nodes: array(ref('node')) })), location: ref('location'),
    }, ['parameters', 'key']),
    text: object({ kind: { const: 'text' }, text: string }),
    expressionNode: object({ kind: { const: 'expression' }, source: string, type: string, location: ref('location') }),
  },
} as const;

// --- Validation ---

const typeOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;

/**
 * Validate a document against `appModelSchema`. Supports the keywords that
 * schema uses; returns the JSON pointer and reason of each failure.
 */
export function validateAppModel(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const defs = appModelSchema.$defs as Record<string, Schema>;
  const check = (schema: Schema, data: unknown, path: string): boolean => {
    if (typeof schema.$ref === 'string') return check(defs[schema.$ref.slice('#/$defs/'.length)], data, path);
    if ('const' in schema && data !== schema.const) return fail(path, `must be ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.includes(data)) return fail(path, `must be one of ${schema.enum.join(', ')}`);
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actual = typeOf(data);
      if (!types.some((type) => type === actual || (type === 'number' && actual === 'integer'))) return fail(path, `must be ${types.join(' or ')}`);
    }
    if (typeof schema.minimum === 'number' && typeof data === 'number' && data < schema.minimum) return fail(path, `must be at least ${schema.minimum}`);
    if (Array.isArray(schema.anyOf) && !schema.anyOf.some((option) => quiet(option as Schema, data, path))) return closest(schema.anyOf as Schema[], data, path);
    if (Array.isArray(schema.oneOf)) {
      const matches = schema.oneOf.filter((option) => quiet(option as Schema, data, path)).length;
      if (matches > 1) return fail(path, 'matches more than one shape');
      if (matches === 0) return closest(schema.oneOf as Schema[], data, path);
    }
    if (typeOf(data) === 'array' && schema.items) {
      return (data as unknown[]).map((item, index) => check(schema.items as Schema, item, `${path}/${index}`)).every(Boolean);
    }
    if (typeOf(data) === 'object' && (schema.properties || schema.additionalProperties !== undefined)) {
      const record = data as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      let ok = true;
      for (const key of (schema.required ?? []) as string[]) if (!(key in record)) ok = fail(`${path}/${key}`, 'is required');
      for (const [key, item] of Object.entries(record)) {
        const property = properties[key];
        if (property) ok = check(property, item, `${path}/${key}`) && ok;
        else if (schema.additionalProperties === false) ok = fail(`${path}/${key}`, 'is not allowed');
        else if (typeof schema.additionalProperties === 'object') ok = check(schema.additionalProperties as Schema, item, `${path}/${key}`) && ok;
      }
      return ok;
    }
    return true;
  };
  const fail = (path: string, reason: string): false => {
    errors.push(`${path || '/'} ${reason}`);
    return false;
  };
  // When no shape matches, report inside the one meant for this value: the
  // node with the same `kind`, or the only shape of the same JSON type.
  const resolve = (schema: Schema): Schema => typeof schema.$ref === 'string' ? resolve(defs[schema.$ref.slice('#/$defs/'.length)]) : schema;
  const closest = (options: Schema[], data: unknown, path: string): false => {
    const resolved = options.map(resolve);
    const kind = typeOf(data) === 'object' ? (data as Record<string, unknown>).kind : undefined;
    const byKind = resolved.filter((option) => (option.properties as Record<string, Schema> | undefined)?.kind?.const === kind && kind !== undefined);
    const byType = resolved.filter((option) => option.type !== undefined && [option.type].flat().includes(typeOf(data)));
    const target = byKind.length === 1 ? byKind[0] : byKind.length === 0 && byType.length === 1 && !resolved.some((option) => (option.properties as Record<string, Schema> | undefined)?.kind) ? byType[0] : undefined;
    if (target) {
      check(target, data, path);
      return false;
    }
    return fail(path, 'matches no allowed shape');
  };
  // Tries a branch without reporting its failures.
  const quiet = (schema: Schema, data: unknown, path: string): boolean => {
    const count = errors.length;
    const ok = check(schema, data, path);
    errors.length = count;
    return ok;
  };
  check(appModelSchema as unknown as Schema, value, '');
  return { valid: errors.length === 0, errors };
}
