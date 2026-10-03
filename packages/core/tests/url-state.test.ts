// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { defineUrlState, url, UrlStateError } from '../src/shared/url-state';

const filters = defineUrlState({ search: url.string(), page: url.integer({ default: 1, min: 1 }),
    sort: url.enum(['name', 'price']), active: url.boolean(), tags: url.array(url.string()),
    optional: url.optional(url.string()) });
const defaults = { search: '', page: 1, sort: 'name', active: false, tags: [], optional: undefined };
describe('portable URL state', () => {
    it('parses defaults, Unicode, numbers, enums, booleans and repeated arrays', () => {
        expect(filters.read('/list').values).toEqual(defaults);
        expect(filters.read('/list?search=%E9%9B%AA+%26+books&page=2&sort=price&active=true&tags=a&tags=b&optional=')).toEqual({
            values: { search: '雪 & books', page: 2, sort: 'price', active: true, tags: ['a', 'b'], optional: '' }, issues: [] });
    });
    it.each(['', '0', '-1', '1.5', 'Infinity', 'NaN', '0x10', ' 2', '9007199254740992'])('resets an invalid page %j and reports a stable issue', value => {
        expect(filters.read('/?page=' + encodeURIComponent(value))).toMatchObject({ values: { page: 1 }, issues: [{ field: 'page', code: 'invalid-value' }] });
    });
    it.each(['1', 'TRUE', '', 'yes'])('rejects an ambiguous boolean %j', value => {
        expect(filters.read('/?active=' + value)).toMatchObject({ values: { active: false }, issues: [{ field: 'active', code: 'invalid-value' }] });
    });
    it('does not choose an arbitrary repeated scalar, even when values agree', () => {
        expect(filters.read('/?page=2&page=2')).toMatchObject({ values: { page: 1 }, issues: [{ field: 'page', code: 'repeated-scalar' }] });
    });
    it.each(['%broken', '%FF', '%E2%82'])('retains strict invalid encoding diagnostics without raw input %s', value => {
        expect(filters.read('/?search=' + value)).toMatchObject({ values: { search: '' }, issues: [{ field: 'search', code: 'invalid-encoding' }] });
    });
    it('normalizes declared fields and preserves unrelated query bytes and fragments', () => {
        const destination = filters.url('/list?utm=a%20b&search=old&page=bad&utm=c&%broken=z&other=%FF#row',
            { search: '雪 & books', page: 3, tags: ['a/b', ''] });
        expect(destination).toBe('/list?utm=a%20b&utm=c&%broken=z&other=%FF&page=3&search=%E9%9B%AA+%26+books&tags=a%2Fb&tags=#row');
        expect(filters.read(destination).values).toEqual({ ...defaults, search: '雪 & books', page: 3, tags: ['a/b', ''] });
    });
    it('omits defaults, permits explicit defaults, and resets values with undefined', () => {
        expect(filters.url('/?page=5', { page: undefined })).toBe('/');
        expect(filters.url('/#top', {}, { defaults: 'include' })).toBe('/?active=false&page=1&search=&sort=name&tags#top');
        expect(filters.read(filters.url('/', {}, { defaults: 'include' })).values).toEqual(defaults);
    });
    it('distinguishes an empty array from an empty item and from a nonempty default', () => {
        const state = defineUrlState({ tags: url.array(url.string(), { default: ['starter'] }) });
        expect(state.url('/', { tags: [] })).toBe('/?tags');
        expect(state.read('/?tags').values.tags).toEqual([]);
        expect(state.read('/?tags=').values.tags).toEqual(['']);
        expect(state.read('/?tags&tags=a')).toMatchObject({ values: { tags: ['starter'] }, issues: [{ field: 'tags', code: 'invalid-value' }] });
    });
    it('rejects one invalid array element rather than silently deleting it', () => {
        const state = defineUrlState({ ids: url.array(url.integer(), { default: [4], maxItems: 2 }) });
        expect(state.read('/?ids=1&ids=bad')).toMatchObject({ values: { ids: [4] }, issues: [{ code: 'invalid-value' }] });
        expect(state.read('/?ids=1&ids=2&ids=3')).toMatchObject({ values: { ids: [4] }, issues: [{ code: 'invalid-value' }] });
    });
    it('allows optional arrays and bounded decimal numbers', () => {
        const state = defineUrlState({ items: url.optional(url.array(url.boolean())), n: url.number({ default: 0, min: -10, max: 20 }) });
        expect(state.read('/?n=1.25e1').values).toEqual({ n: 12.5, items: undefined });
        expect(state.url('/', { items: [true, false], n: -2.5 })).toBe('/?items=true&items=false&n=-2.5');
        expect(state.read('/?n=21').issues).toEqual([{ field: 'n', code: 'invalid-value' }]);
    });
    it('snapshots the declaration and defaults and returns immutable records', () => {
        const original = ['first']; const shape = { tags: url.array(url.string(), { default: original }) };
        const state = defineUrlState(shape); original.push('second'); shape.tags = url.array(url.string());
        const result = state.read('/'); expect(result.values.tags).toEqual(['first']);
        expect(Object.isFrozen(result.values)).toBe(true); expect(Object.isFrozen(result.values.tags)).toBe(true);
        expect(Object.isFrozen(result.issues)).toBe(true); expect(Object.isFrozen(state)).toBe(true);
    });
    it('keeps prototype-shaped field names as ordinary data without inheriting patch keys', () => {
        const shape = Object.create(null); shape.__proto__ = url.string(); shape.constructor = url.string();
        const state = defineUrlState(shape);
        expect(state.read('/?__proto__=value&constructor=original').values).toEqual(JSON.parse('{"__proto__":"value","constructor":"original"}'));
        expect(state.url('/?constructor=original', {})).toBe('/?constructor=original');
        expect(Object.getPrototypeOf(state.read('/').values)).toBe(Object.prototype);
    });
    it('rejects unknown and accessor patches without reading a value', () => {
        const getter = vi.fn(); const patch = Object.defineProperty({}, 'page', { get: getter });
        expect(() => filters.url('/', patch)).toThrow(UrlStateError); expect(getter).not.toHaveBeenCalled();
        expect(() => filters.url('/', { missing: 1 } as any)).toThrow(expect.objectContaining({ code: 'COSSACK_URL_STATE_FIELD_UNKNOWN', field: 'missing' }));
        expect(() => defineUrlState(Object.defineProperty({}, 'q', { get: getter }) as any)).toThrow(UrlStateError);
        expect(getter).not.toHaveBeenCalled();
    });
    it.each([NaN, Infinity, 0, 2.5, '2'])('rejects invalid typed patch data %j', value => {
        expect(() => filters.url('/', { page: value } as any)).toThrow(expect.objectContaining({ code: 'COSSACK_URL_STATE_VALUE_INVALID' }));
    });
    it('rejects sparse arrays, accessors, extra array properties and lone surrogate strings', () => {
        const getter = vi.fn(); const accessor: string[] = []; Object.defineProperty(accessor, '0', { get: getter });
        for (const tags of [new Array(1), accessor, Object.assign(['x'], { extra: 1 })]) expect(() => filters.url('/', { tags })).toThrow(UrlStateError);
        expect(getter).not.toHaveBeenCalled();
        expect(() => filters.url('/', { search: '\ud800' })).toThrow(UrlStateError);
    });
    it('bounds total encoded query text and pair counts before parsing', () => {
        expect(() => filters.read('/?unknown=' + 'x'.repeat(65_536))).toThrow(expect.objectContaining({ code: 'COSSACK_URL_STATE_LIMIT' }));
        expect(() => filters.read('/?' + new Array(1_025).fill('x=1').join('&'))).toThrow(UrlStateError);
    });
    it('uses the same length boundary for reading and writing', () => {
        const current = '/?other=' + 'x'.repeat(65_530);
        expect(filters.read(current).values).toEqual(defaults);
        expect(filters.url(current, {})).toBe(current);
    });
    it('bounds string/array fields and rejects invalid configurations', () => {
        const state = defineUrlState({ text: url.string({ default: 'ok', maxLength: 2 }) });
        expect(state.read('/?text=long').issues).toEqual([{ field: 'text', code: 'invalid-value' }]);
        for (const factory of [() => url.string({ maxLength: 3_000 }), () => url.integer({ min: 1 }),
            () => url.array(url.string(), { maxItems: 101 }), () => url.enum(['same', 'same']), () => defineUrlState({})]) expect(factory).toThrow(UrlStateError);
    });
    it('uses explicit custom codecs and checks serialization round trips', () => {
        const hex = url.custom({ default: 0, parse: value => /^[a-f0-9]+$/i.test(value) ? parseInt(value, 16) : undefined, serialize: value => value.toString(16) });
        const state = defineUrlState({ value: hex }); expect(state.read('/?value=ff').values.value).toBe(255);
        expect(state.url('/', { value: 255 })).toBe('/?value=ff');
        const broken = defineUrlState({ value: url.custom({ default: 0, parse: () => 0, serialize: () => 'x' }) });
        expect(() => broken.url('/', { value: 1 })).toThrow(expect.objectContaining({ code: 'COSSACK_URL_STATE_CODEC_FAILED' }));
    });
    it('keeps unexpected custom callback errors private and does not convert them into invalid input', () => {
        const state = defineUrlState({ secret: url.custom({ default: '', parse() { throw new Error('PRIVATE_VALUE'); }, serialize: String }) });
        expect(() => state.read('/?secret=value')).toThrow(expect.objectContaining({ code: 'COSSACK_URL_STATE_CODEC_FAILED', field: 'secret' }));
        try { state.read('/?secret=value'); } catch (error) { expect(String(error)).not.toContain('PRIVATE_VALUE'); }
    });
    it('rejects unsupported asynchronous callback results and observes their late rejections', async () => {
        const state = defineUrlState({ value: url.custom({ default: '', parse: async () => { throw new Error('PRIVATE_LATE'); }, serialize: String } as any) });
        expect(() => state.read('/?value=x')).toThrow(expect.objectContaining({ code: 'COSSACK_URL_STATE_CODEC_FAILED' }));
        await new Promise(resolve => setTimeout(resolve, 0));
    });
});
