import { describe, expect, it } from 'vitest';
import {
    commandInput, declarationHash, defineResource, evaluateRule, field, formInput, formValue, isPluginPoint, manifestProblems, permissionMatches, providedPoints,
    requestedGrants, resolveResource, resourceProblems, storageCheck, storageName, storageType, userPrincipal, validateValue, normalizeDeclaration, fieldProblems,
} from '../src/index';
import { planSchema, type Catalog } from '../src/server/schema';

const catalog = (tables: Catalog['tables'] = new Map(), ledger: Partial<Catalog['ledger']> = {}): Catalog => ({
    sequence: 7, engineVersion: '0.2.9', tables,
    ledger: { host: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), explicit: new Map(), hashes: new Map(), ...ledger },
});

describe('fields', () => {
    it('validates input by kind', () => {
        expect(validateValue('t', field.string({ max: 3 }), 'abcd')).toMatch(/at most 3/);
        expect(validateValue('t', field.string({ pattern: '[a-z]+' }), 'Abc')).toMatch(/format/);
        expect(validateValue('t', field.string(), '\ud800')).toMatch(/well-formed/);
        expect(validateValue('n', field.integer({ min: 1 }), 0)).toMatch(/at least 1/);
        expect(validateValue('n', field.integer(), 1.5)).toMatch(/safe integer/);
        expect(validateValue('b', field.bigint(), '9223372036854775807')).toBeUndefined();
        expect(validateValue('b', field.bigint(), '9223372036854775808')).toMatch(/outside int64/);
        expect(validateValue('j', field.json(), { a: [1, 1.5, null, { b: 'x' }] })).toBeUndefined();
        expect(validateValue('j', field.json(), { a: 2 ** 60 })).toMatch(/JSON object/);
        expect(validateValue('l', field.list('integer'), [1, 2])).toBeUndefined();
        expect(validateValue('l', field.list('integer'), [1, 'x'])).toMatch(/item 2 must be a safe integer/);
        expect(validateValue('v', field.vector(2), [1, 2])).toBeUndefined();
        expect(validateValue('v', field.vector(2), [1])).toMatch(/2 finite numbers/);
        expect(validateValue('x', field.string(), null)).toMatch(/null/);
        expect(validateValue('x', field.string({ nullable: true }), null)).toBeUndefined();
    });

    it('holds several values of a kind with the multiple flag', () => {
        const tags = field.string({ multiple: true, max: 5, pattern: '[a-z]+', maxItems: 3, minItems: 1 });
        expect(validateValue('tags', tags, ['one', 'two'])).toBeUndefined();
        expect(validateValue('tags', tags, ['one', 'toolong'])).toMatch(/item 2 must be at most 5/);
        expect(validateValue('tags', tags, ['one', 'Two'])).toMatch(/item 2 has an invalid format/);
        expect(validateValue('tags', tags, [])).toMatch(/at least 1 item/);
        expect(validateValue('tags', tags, ['a', 'b', 'c', 'd'])).toMatch(/at most 3 items/);
        expect(validateValue('tags', tags, 'one')).toMatch(/must be a list/);
        expect(validateValue('tags', field.string({ multiple: true, required: true }), [])).toMatch(/at least 1 item/);
        expect(validateValue('tags', field.string({ multiple: true }), [null])).toMatch(/item 1 cannot be null/);
        expect(validateValue('ref', field.reference('cms/posts', { multiple: true }), ['a', 'b'])).toBeUndefined();
        expect(validateValue('sizes', field.enum(['s', 'm'], { multiple: true }), ['s', 'l'])).toMatch(/item 2 must be one of/);
        expect(storageType(field.reference('cms/posts', { multiple: true }), target => `r__${target.replace('/', '__')}`)).toBe('array<record<r__cms__posts>>');
        expect(storageType(field.richText({ multiple: true }), () => '')).toBe('array<object>');
        expect(storageType(field.terms('tags'), () => '')).toBe('array<string>');
        expect(storageCheck('"tags"', tags)).toBeUndefined();
        expect(fieldProblems('b', field.boolean({ multiple: true }))).toEqual(['field b: multiple is true or false and applies to strings, text, choices, numbers, times, references, JSON and rich text.']);
        expect(fieldProblems('t', field.string({ multiple: true, maxItems: 2000 }))).toEqual(['field t: maxItems applies to multiple fields and is 1-1000.']);
        expect(fieldProblems('m', field.media({ multiple: true, maxItems: 500 }))).toEqual(['field m: maxItems applies to multiple fields and is 1-200.']);
        expect(fieldProblems('t', field.string({ minItems: 1 }))).toEqual(['field t: minItems applies to multiple fields and is 0 to maxItems.']);
        expect(fieldProblems('t', field.string({ multiple: true, unique: true }))).toEqual(['field t: multiple fields cannot be unique.']);
        expect(fieldProblems('t', field.string({ multiple: true, index: true, default: ['a'] }))).toEqual([]);
        expect(fieldProblems('t', field.string({ multiple: true, default: 'a' }))).toEqual(['field t: default must be a list of at most 1000 items.']);
        expect(normalizeDeclaration({ kind: 'list', items: 'string', index: true, label: 'Tags' } as never)).toEqual({ kind: 'string', multiple: true, index: true, label: 'Tags' });
        expect(normalizeDeclaration(field.rows({ old: { kind: 'list', items: 'number' } as never }))).toEqual(field.rows({ old: { kind: 'number', multiple: true } }));
        expect(normalizeDeclaration(tags)).toBe(tags);
    });

    it('renders deterministic checks with quoted names', () => {
        expect(storageCheck('"title"', field.string({ max: 10, min: 2 }))).toBe('length("title") <= 10 AND length("title") >= 2');
        expect(storageCheck('"s"', field.enum(['a', 'b']))).toBe(`"s" IN ('a', 'b')`);
        expect(storageCheck('"n"', field.integer({ min: 0, max: 9 }))).toBe('"n" >= 0 AND "n" <= 9');
    });
});

describe('resources', () => {
    const posts = defineResource({ name: 'posts', fields: { title: field.string({ required: true }) } });

    it('rejects invalid declarations', () => {
        expect(resourceProblems({ name: 'Bad Name', fields: {} })).toEqual(expect.arrayContaining([expect.stringContaining('name must be'), 'declare at least one field.']));
        expect(resourceProblems({ name: 'x', fields: { a: field.string(), A: field.string() } })).toContain('field A differs from another field only by case.');
        expect(resourceProblems({ name: 'x', fields: { a: field.string() }, access: { read: 'owner' } })).toContain('access.read: owner rules need ownership: true.');
        expect(resourceProblems({ name: 'x', fields: { a: field.string() }, migrations: [{ version: 1, kind: 'drop', field: 'a' }] })).toContain('migration 1: drop names a, which is still declared.');
        expect(() => defineResource({ name: 'x', fields: { j: { kind: 'json', unique: true } } })).toThrow(/cannot be indexed/);
    });

    it('assigns owner, storage and default permission rules', () => {
        const resource = resolveResource(posts, 'support-desk');
        expect(resource).toMatchObject({ id: 'support-desk/posts', storage: 'r__support_desk__posts', revisions: true, ownership: false });
        expect(resource.access.update).toEqual({ permission: 'support-desk/posts:update' });
        expect(storageName('a-b', 'c')).not.toBe(storageName('a', 'b_c'));
    });

    it('hashes canonical declarations', async () => {
        const a = resolveResource({ name: 'p', fields: { a: field.string(), b: field.integer() } });
        const b = resolveResource({ fields: { b: field.integer(), a: field.string() }, name: 'p' });
        expect(await declarationHash(a)).toBe(await declarationHash(b));
        expect(await declarationHash(a)).not.toBe(await declarationHash(resolveResource({ name: 'p', fields: { a: field.string({ max: 9 }), b: field.integer() } })));
    });
});

describe('permissions', () => {
    it('matches patterns and evaluates rules', () => {
        expect(permissionMatches('*', 'cms/posts:read')).toBe(true);
        expect(permissionMatches('cms/*', 'cms/posts:read')).toBe(true);
        expect(permissionMatches('cms/posts:*', 'cms/pages:read')).toBe(false);
        const editor = userPrincipal('u', ['editor'], ['cms/posts:update']);
        expect(evaluateRule({ any: ['owner', { permission: 'cms/posts:update' }] }, editor)).toBe('allow');
        expect(evaluateRule({ any: ['owner', { permission: 'cms/posts:delete' }] }, editor)).toBe('owner');
        expect(evaluateRule('authenticated', { kind: 'anonymous' })).toBe('deny');
        expect(evaluateRule('none', { kind: 'system', reason: 'x' })).toBe('allow');
    });
});

describe('plugin manifests', () => {
    const manifest = {
        schemaVersion: 1, name: 'desk', version: '1.0.0',
        resources: [{ name: 'tickets', fields: { subject: field.string() } }],
        hooks: [{ point: 'cms.resource.after-commit', version: 1 }],
        permissions: { resources: { 'cms/posts': ['read', 'update'] }, network: ['api.example.com'], define: ['desk:triage'] },
        commands: [{ name: 'close', description: 'Close.', options: { days: { type: 'number', required: true }, dry: { type: 'boolean' } } }],
    };

    it('validates CMS fields and lists requested grants', () => {
        expect(manifestProblems(manifest)).toEqual([]);
        expect(requestedGrants(manifest as never)).toEqual(['hook:cms.resource.after-commit', 'network:api.example.com', 'resource:cms/posts:read', 'resource:cms/posts:update']);
        expect(manifestProblems({ ...manifest, hooks: [{ point: 'cms.resource.after-commit', version: 2 }], extra: true, permissions: { define: ['other:x'], network: ['not a host'] } }))
            .toEqual(['extra is not a manifest field.', 'hooks: cms.resource.after-commit is version 1, not 2.', 'permissions.network: not a host is not a host name.', 'permissions.define: other:x must be named desk:<name>.']);
        expect(manifestProblems({ ...manifest, ui: { slots: { 'dashboard.footer': [] } } })).toEqual([expect.stringContaining('not a host slot')]);
    });

    it('lets a plugin provide extension points and others hook into them', () => {
        const provider = { ...manifest, provides: [{ point: 'desk.ticket-closed', kind: 'action', version: 2, timeoutMs: 100 }, { point: 'desk.priority', kind: 'filter', version: 1, description: 'The priority of a new ticket.' }] };
        expect(manifestProblems(provider)).toEqual([]);
        const [closed, priority] = providedPoints(provider as never);
        expect(closed).toMatchObject({ name: 'desk.ticket-closed', kind: 'action', version: 2, timeoutMs: 100 });
        expect(priority).toMatchObject({ name: 'desk.priority', kind: 'filter', version: 1, timeoutMs: 5_000 });
        expect(manifestProblems({ ...manifest, provides: [{ point: 'other.x', kind: 'action', version: 1 }, { point: 'desk.y', kind: 'event', version: 0, timeoutMs: 0 }, { point: 'desk.y', kind: 'filter', version: 1 }] })).toEqual([
            'provides: other.x must be named desk.<name>.', 'provides: desk.y must be an action or a filter.', 'provides: desk.y needs a version of 1 or more.', 'provides: desk.y timeoutMs must be 1 to 600000.', 'provides: desk.y is declared twice.']);
        // A consumer names another plugin's point; the host checks it against the provider.
        const consumer = { schemaVersion: 1, name: 'loyalty', version: '1.0.0', hooks: [{ point: 'desk.ticket-closed', version: 2 }, { point: 'cms.nope', version: 1 }, { point: 'desk.priority', version: 0 }] };
        expect(manifestProblems(consumer)).toEqual(['hooks: cms.nope is not a CMS extension point.', 'hooks: desk.priority needs a version of 1 or more.']);
        expect(requestedGrants({ ...consumer, hooks: consumer.hooks.slice(0, 1) } as never)).toEqual(['hook:desk.ticket-closed']);
        expect(isPluginPoint('desk.ticket-closed')).toBe(true);
        expect(isPluginPoint('cms.resource.before-write')).toBe(false);
        expect(isPluginPoint('nodot')).toBe(false);
    });

    it('checks command input against declared options', () => {
        const command = manifest.commands[0] as never;
        expect(commandInput(command, { days: '3', dry: 'true' })).toEqual({ values: { days: 3, dry: true }, problems: [] });
        expect(commandInput(command, { other: 1 }).problems).toEqual(['--other is not an option of close.', '--days is required.']);
    });
});

describe('forms', () => {
    const fields = { title: field.string({ required: true }), count: field.integer(), live: field.boolean(), at: field.datetime({ nullable: true }), tags: field.list('string'), meta: field.json() };

    it('reads typed input from submitted forms', () => {
        const form = new FormData();
        form.set('title', ' Hello '); form.set('count', '3'); form.set('at', '2026-10-16T10:00'); form.set('tags', 'a, b\nc'); form.set('meta', '{"x":1}');
        expect(formInput(fields, form)).toEqual({ input: { title: 'Hello', count: 3, live: false, at: Date.UTC(2026, 9, 16, 10), tags: ['a', 'b', 'c'], meta: { x: 1 } }, errors: {} });
        const bad = new FormData();
        bad.set('count', '1.5'); bad.set('meta', '{'); bad.set('at', '');
        expect(formInput(fields, bad)).toEqual({ input: { live: false, at: null }, errors: { count: 'must be a whole number.', meta: 'must be valid JSON.' } });
        expect(formValue(fields.at, Date.UTC(2026, 9, 16, 10))).toBe('2026-10-16T10:00');
    });
});

describe('schema planner on a synthetic catalog', () => {
    const tickets = resolveResource({ name: 'tickets', fields: { subject: field.string({ required: true, max: 50 }), status: field.enum(['open', 'closed'], { default: 'open' }) } });

    it('plans the same DDL for the same declaration and catalog', async () => {
        const [a, b] = await Promise.all([planSchema([tickets], catalog()), planSchema([tickets], catalog())]);
        expect(a.steps.map(step => step.statements)).toEqual(b.steps.map(step => step.statements));
        expect(a.steps[0]!.statements.map(statement => statement.rql)).toEqual([
            'CREATE TABLE r__app__tickets',
            'DEFINE FIELD "_rev" ON r__app__tickets TYPE integer REQUIRED CHECK("_rev" >= 1 AND "_rev" <= 9007199254740991)',
            'DEFINE FIELD "_op" ON r__app__tickets TYPE string REQUIRED CHECK(length("_op") <= 80)',
            'DEFINE FIELD "_createdAt" ON r__app__tickets TYPE integer REQUIRED CHECK("_createdAt" >= -9007199254740991 AND "_createdAt" <= 9007199254740991)',
            'DEFINE FIELD "_updatedAt" ON r__app__tickets TYPE integer REQUIRED CHECK("_updatedAt" >= -9007199254740991 AND "_updatedAt" <= 9007199254740991)',
            'DEFINE FIELD "_owner" ON r__app__tickets TYPE string NULLABLE CHECK(length("_owner") <= 80)',
            'DEFINE FIELD "subject" ON r__app__tickets TYPE string REQUIRED CHECK(length("subject") <= 50)',
            `DEFINE FIELD "status" ON r__app__tickets TYPE string DEFAULT 'open' CHECK("status" IN ('open', 'closed'))`,
            'DEFINE SCHEMA ON r__app__tickets STRICT',
            'CREATE INDEX r__app__tickets___updated ON r__app__tickets ("_updatedAt")',
        ]);
        expect(a.steps[0]).toMatchObject({ kind: 'additive', resource: 'app/tickets' });
    });

    it('reports drift that needs an explicit step', async () => {
        const created = await planSchema([tickets], catalog());
        const fields = created.steps[0]!.statements.filter(statement => statement.rql.startsWith('DEFINE FIELD')).map(statement => {
            const [, name, type] = /DEFINE FIELD "([^"]+)" ON \S+ TYPE (\S+)/.exec(statement.rql)!;
            const check = /CHECK\((.*)\)$/.exec(statement.rql)?.[1] ?? null;
            return { path: [name!], type: type!, element_type: null, required: statement.rql.includes(' REQUIRED'), nullable: statement.rql.includes(' NULLABLE'),
                has_default: statement.rql.includes(' DEFAULT'), default: statement.rql.includes(' DEFAULT') ? 'open' : null, check, flexible: false };
        });
        const table = { name: 'r__app__tickets', model: 'document', strict: true, fields, indexes: [{ name: 'r__app__tickets___updated', kind: 'scalar', paths: [['_updatedAt']], unique: false }] };
        const hash = await declarationHash(tickets);
        const current = await planSchema([tickets], catalog(new Map([[table.name, table]]), { hashes: new Map([['app/tickets', hash]]) }));
        expect(current).toMatchObject({ steps: [], blocked: [], current: ['app/tickets'] });
        const widened = resolveResource({ name: 'tickets', fields: { subject: field.string({ required: true, max: 80 }), status: field.enum(['open', 'closed'], { default: 'open' }) } });
        const drift = await planSchema([widened], catalog(new Map([[table.name, table]]), { hashes: new Map([['app/tickets', hash]]) }));
        expect(drift.blocked).toEqual([expect.objectContaining({ field: 'subject', message: expect.stringContaining('check') })]);
    });

    it('indexes filterable row fields on their path into the rows, from RomeDB 0.2.11', async () => {
        const team = resolveResource({ name: 'teams', fields: { members: field.rows({ role: field.string({ index: true }), order: field.rows({ kind: field.string({ unique: true }), note: field.string() }) }) } });
        const older = await planSchema([team], catalog());
        expect(older.steps).toEqual([]);
        expect(older.blocked).toEqual([{ resource: 'app/teams', message: 'Filterable repeater fields need RomeDB 0.2.11 or later; the database runs 0.2.9.' }]);
        const current = await planSchema([team], { ...catalog(), engineVersion: '0.2.11' });
        expect(current.blocked).toEqual([]);
        expect(current.steps.flatMap(step => step.statements.map(statement => statement.rql)).filter(rql => rql.includes('USING ARRAY'))).toEqual([
            'CREATE SEARCH INDEX r__app__teams__r_members__role ON r__app__teams("members".*."role") USING ARRAY',
            'CREATE SEARCH INDEX r__app__teams__r_members__order__kind ON r__app__teams("members".*."order".*."kind") USING ARRAY',
        ]);
    });
});

describe('content helpers', () => {
    it('makes URL slugs from titles', async () => {
        const { slugify } = await import('../src/index');
        expect(slugify('Hello, World!')).toBe('hello-world');
        expect(slugify('  Crème brûlée — đặc biệt  ')).toBe('creme-brulee-dac-biet');
        expect(slugify("Don't stop")).toBe('dont-stop');
        expect(slugify('日本語')).toBe('');
        expect(slugify('one two three', 8)).toBe('one-two');
    });

    it('scopes access rules to owners and record conditions', async () => {
        const { ruleScope } = await import('../src/index');
        const rule = { any: [{ where: { status: 'published' } }, 'owner', { permission: 'cms/posts:read' }] } as const;
        expect(ruleScope(rule, { kind: 'anonymous' })).toEqual({ owner: false, where: [{ status: 'published' }] });
        expect(ruleScope(rule, userPrincipal('a', [], []))).toEqual({ owner: true, where: [{ status: 'published' }] });
        expect(ruleScope(rule, userPrincipal('e', ['editor'], ['cms/*']))).toBe('allow');
        expect(resourceProblems({ name: 'x', fields: { a: field.string() }, access: { read: { where: { missing: 'x' } } } })).toEqual([expect.stringContaining('missing')]);
    });

    it('checks file signatures and reads image sizes', async () => {
        const { imageSize, matchesSignature } = await import('../src/index');
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 0, 200]);
        expect(matchesSignature('image/png', png)).toBe(true);
        expect(imageSize('image/png', png)).toEqual({ width: 256, height: 200 });
        expect(matchesSignature('image/png', new TextEncoder().encode('<svg onload=alert(1)>'))).toBe(false);
        const gif = new Uint8Array([...new TextEncoder().encode('GIF89a'), 3, 0, 2, 0]);
        expect(imageSize('image/gif', gif)).toEqual({ width: 3, height: 2 });
        // SOI, an APP0 segment, then SOF0 with height 0x10 and width 0x20.
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 0x10, 0, 0x20, 3, 0, 0, 0]);
        expect(matchesSignature('image/jpeg', jpeg)).toBe(true);
        expect(imageSize('image/jpeg', jpeg)).toEqual({ width: 32, height: 16 });
        expect(matchesSignature('text/plain', new Uint8Array([104, 0, 105]))).toBe(false);
        const { declaredType, mediaKind, sanitizeSvg } = await import('../src/index');
        const text = (value: string) => new TextEncoder().encode(value);
        // SVG by its root element; any other type by its declaration alone.
        expect(matchesSignature('image/svg+xml', text('<?xml version="1.0"?>\n<!-- made by hand -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true);
        expect(matchesSignature('image/svg+xml', text('<html><svg></svg></html>'))).toBe(false);
        expect(matchesSignature('application/zip', new Uint8Array([1, 2, 3]))).toBe(true);
        expect(matchesSignature('application/x-msdownload', new Uint8Array([77, 90]))).toBe(true);
        expect(declaredType('Image/PNG; charset=binary')).toBe('image/png');
        expect(declaredType('')).toBe('application/octet-stream');
        expect(declaredType('not a type')).toBe('application/octet-stream');
        expect(mediaKind('application/zip')).toBe('archive');
        expect(mediaKind('application/pdf')).toBe('document');
        expect(mediaKind('image/svg+xml')).toBe('image');
        const dirty = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><circle r="1" fill="url(http://evil.example/x)"/></a>'
            + '<use href="#ok"/><image href="https://evil.example/track.png"/><foreignObject><body onclick="x"></body></foreignObject><set attributeName="x" to="1"/></svg>';
        const clean = sanitizeSvg(dirty)!;
        expect(clean).not.toMatch(/script|onload|onclick|javascript|evil\.example|foreignObject|<set/i);
        expect(clean).toContain('<use href="#ok"/>');
        expect(clean).toContain('<circle r="1" fill="none"/>');
        expect(sanitizeSvg('<html><body>no</body></html>')).toBeNull();
    });

    it('renders Markdown with raw HTML escaped', async () => {
        const { renderMarkdown, excerptOf } = await import('../src/server/index');
        expect(renderMarkdown('# Title\n\n**bold** <script>alert(1)</script> [x](javascript:alert(1))')).toBe(
            '<h1>Title</h1>\n<p><strong>bold</strong> &lt;script&gt;alert(1)&lt;/script&gt; [x](javascript:alert(1))</p>\n');
        expect(excerptOf('# Title\n\nOne *two* three four', 3)).toBe('Title One two…');
    });

    it('formats dates in the site timezone', async () => {
        const { formatSiteDate } = await import('../src/index');
        const at = Date.UTC(2026, 9, 16, 23, 30);
        expect(formatSiteDate(at, { 'general.timezone': 'UTC', 'general.dateFormat': 'long' })).toBe('October 16, 2026');
        expect(formatSiteDate(at, { 'general.timezone': 'Asia/Ho_Chi_Minh', 'general.dateFormat': 'iso' }, { time: '24h' })).toBe('2026-10-17 06:30');
    });
});
