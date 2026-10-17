import { describe, expect, it } from 'vitest';
import {
    checkComment, collectionProblems, compareRecords, diffWords, field, imageEditsProblems, imageSrcset, imageUrl, posts, redirectPath, redirectProblems,
    validateValue, variantRect, variantWidth, webhookUrlProblem,
} from '../src/index';
import { negotiateFormat } from '../src/server/images';

describe('essentials helpers', () => {
    it('diffs words and keeps layout', () => {
        expect(diffWords('one two three', 'one 2 three four')).toEqual([
            { kind: 'same', text: 'one ' }, { kind: 'removed', text: 'two' }, { kind: 'added', text: '2' }, { kind: 'same', text: ' three' }, { kind: 'added', text: ' four' },
        ]);
        expect(diffWords('', '')).toEqual([]);
        // Too many tokens are reported as replaced.
        expect(diffWords('a b c', 'x y z', 3)).toEqual([{ kind: 'removed', text: 'a b c' }, { kind: 'added', text: 'x y z' }]);
        const changes = compareRecords({ title: field.string({ label: 'Title' }), sticky: field.boolean({ label: 'Sticky' }), body: field.richText({ label: 'Body' }) },
            { id: 'a', rev: 1, createdAt: 0, updatedAt: 0, owner: null, title: 'Old', sticky: false, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same text' }] }] } },
            { id: 'a', rev: 2, createdAt: 0, updatedAt: 0, owner: null, title: 'New', sticky: true, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same text' }] }] } });
        expect(changes.map(change => [change.name, change.kind, change.before, change.after])).toEqual([['title', 'text', 'Old', 'New'], ['sticky', 'value', 'No', 'Yes']]);
    });

    it('validates group fields and field order', () => {
        const seo = field.group({ title: field.string({ max: 5 }), noindex: field.boolean() });
        expect(validateValue('seo', seo, { title: 'Short', noindex: true })).toBeUndefined();
        expect(validateValue('seo', seo, { title: null })).toBeUndefined();
        expect(validateValue('seo', seo, { title: 'Too long' })).toContain('at most 5');
        expect(validateValue('seo', seo, { other: 1 })).toBe('has no subfield other.');
        expect(collectionProblems({ ...posts, fieldOrder: ['Not valid'] })).toContain('The field order names at most 64 fields.');
        expect(collectionProblems({ ...posts, comments: 'yes' as never })).toContain('Comments are on or off.');
    });

    it('checks redirects and webhook URLs', () => {
        expect(redirectPath('/old/page/?utm=1')).toBe('/old/page');
        expect(redirectProblems({ source: '/old', target: '/new' })).toEqual([]);
        expect(redirectProblems({ source: '/old/*', target: 'https://example.com/*' })).toEqual([]);
        expect(redirectProblems({ source: '/', target: '/x' })).toHaveLength(1);
        expect(redirectProblems({ source: '/a/*/b', target: '/x' })).toHaveLength(1);
        expect(redirectProblems({ source: '/a', target: '/b/*' })).toHaveLength(1);
        expect(redirectProblems({ source: '/gone', target: '', status: 410 })).toEqual([]);
        expect(redirectProblems({ source: '/a', target: 'javascript:alert(1)' })).toHaveLength(1);
        expect(webhookUrlProblem('https://hooks.example.com/build')).toBeUndefined();
        expect(webhookUrlProblem('http://localhost:8787/hook')).toBeUndefined();
        expect(webhookUrlProblem('http://example.com/hook')).toContain('HTTPS');
        expect(webhookUrlProblem('https://user:secret@example.com/')).toContain('credentials');
    });

    it('checks posted comments', () => {
        expect(checkComment({ content: ' Hi\r\nthere ', authorName: 'Ann', authorEmail: 'ANN@Example.com' }, true)).toEqual({ content: 'Hi\nthere', authorName: 'Ann', authorEmail: 'ann@example.com', authorUrl: '' });
        expect(() => checkComment({ content: '' }, false)).toThrow('Write a comment.');
        expect(() => checkComment({ content: 'x', authorEmail: 'nope' }, false)).toThrow('valid email');
        expect(() => checkComment({ content: 'x', authorUrl: 'javascript:alert(1)' }, false)).toThrow('https://');
        expect(() => checkComment({ content: 'x' }, true)).toThrow('Enter your name.');
    });

    it('describes image variants around crops and focal points', () => {
        const image = { id: 'f1', name: 'photo one.png', contentType: 'image/png', width: 2000, height: 1000, edits: null, version: 7 };
        expect(variantWidth(700)).toBe(960);
        expect(variantWidth(9000)).toBe(2560);
        expect(imageUrl(image, { width: 700 })).toBe('/media/f1/photo%20one.png?w=960&v=7');
        expect(imageSrcset(image).split(', ').map(entry => entry.split(' ')[1])).toEqual(['320w', '640w', '960w', '1280w', '1920w', '2000w']);
        expect(imageSrcset({ ...image, contentType: 'image/gif' })).toBe('');
        expect(variantRect(image, 1)).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
        expect(variantRect({ ...image, edits: { focus: { x: 1, y: 0.5 } } }, 1)).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 });
        expect(variantRect({ ...image, edits: { crop: { x: 100, y: 100, width: 400, height: 400 } } })).toEqual({ x: 100, y: 100, width: 400, height: 400 });
        expect(imageEditsProblems({ crop: { x: 0, y: 0, width: 10, height: 10 } }, 100, 100)).toHaveLength(1);
        expect(imageEditsProblems({ focus: { x: 2, y: 0 } }, 100, 100)).toHaveLength(1);
        expect(negotiateFormat('image/avif,image/webp,*/*', 'image/png')).toBe('avif');
        expect(negotiateFormat('image/webp,*/*', 'image/jpeg')).toBe('webp');
        expect(negotiateFormat('*/*', 'image/png')).toBe('png');
    });
});
