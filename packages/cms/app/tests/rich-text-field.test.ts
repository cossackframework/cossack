import { afterAll, describe, expect, it, vi } from 'vitest';
import type { RichTextDoc } from '@cossackframework/cms';
import type { RichTextFieldProps } from '../src/cms/rich-text-field';

// The field's prose styles come from the site view, which reads the app's plugins.
vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
// Loaded as browser code: on the server, its client methods are stubs.
vi.stubGlobal('window', { document: {} });
const { RichTextField, docKey } = await import('../src/cms/rich-text-field');
afterAll(() => vi.unstubAllGlobals());

const doc = (text: string): RichTextDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as RichTextDoc;

/** A mounted field in the browser, with a stand-in for the editor. */
function field(value: RichTextDoc | null) {
    const result = new RichTextField();
    result.props = { id: 'content', label: 'Content', value, blocks: [], onChange: vi.fn(), onMedia: vi.fn(), onInsertBlock: vi.fn(), onEditBlock: vi.fn() } as RichTextFieldProps;
    const setContent = vi.fn();
    Object.assign(result, { handle: { setContent }, ready: true, held: docKey(value), heldValue: value });
    return { result, setContent };
}

describe('rich text field updates', () => {
    it('leaves the editor alone when the page renders the same document again', () => {
        const value = doc('Kept');
        const { result, setContent } = field(value);
        const stringify = vi.spyOn(JSON, 'stringify');
        // The page re-renders on every keystroke in another field, with the same value object.
        for (let i = 0; i < 3; i++) result.updated(new Map());
        expect(stringify).not.toHaveBeenCalled();
        stringify.mockRestore();
        expect(setContent).not.toHaveBeenCalled();
    });

    it('puts a document from outside the editor in, and only once', () => {
        const { result, setContent } = field(doc('Before'));
        const restored = doc('Restored');
        result.props = { ...result.props, value: restored };
        result.updated(new Map());
        result.updated(new Map());
        expect(setContent).toHaveBeenCalledExactlyOnceWith(restored);
    });

    it('leaves the editor alone when a copy of its own document comes back', () => {
        const { result, setContent } = field(doc('Same'));
        result.props = { ...result.props, value: doc('Same') };
        result.updated(new Map());
        expect(setContent).not.toHaveBeenCalled();
    });

    it('takes a saved document and the room copy of it as the same document', () => {
        // The saved value has its keys sorted and no null attributes; the room's copy has both.
        const saved = { content: [{ content: [{ text: 'Same', type: 'text' }], type: 'paragraph' }], type: 'doc' } as RichTextDoc;
        const room = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'Same' }] }] } as RichTextDoc;
        expect(docKey(room)).toBe(docKey(saved));
        expect(docKey(doc('Other'))).not.toBe(docKey(saved));
    });
});
