import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { Attachment, type AttachmentProps } from '../src/components/Attachment';
const render = (props: AttachmentProps) => renderToString(component(Attachment, props));

it('forwards native props to the root, button and decorative thumbnail without leaking options', () => {
    const output = render({ name: 'report.pdf', size: '2 MB', thumbnail: '/preview.svg', status: 'Ready', statusVariant: 'success',
        id: 'card', 'data-root': 'card', class: 'custom-card', style: 'color:red',
        thumbnailProps: { id: 'preview', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', 'data-preview': 'file' },
        removeProps: { id: 'remove', disabled: true, 'aria-describedby': 'reason' }, onRemove: () => {} });
    for (const part of ['id="card"', 'custom-card', 'color:red', 'data-root="card"', 'id="preview"', 'loading="lazy"', 'decoding="async"',
        'referrerpolicy="no-referrer"', 'data-preview="file"', 'src="/preview.svg"', 'alt=""', 'aria-hidden="true"',
        'id="remove"', 'aria-describedby="reason"', 'type="button"', 'aria-label="Remove report.pdf"']) expect(output).toContain(part);
    expect(output).toMatch(/\sdisabled(?:\s|=|>)/);
    expect(output).not.toMatch(/\s(?:name|size|thumbnail|thumbnailProps|removeProps|onRemove|status|statusVariant|removeLabel)=/);
});
it.each([['photo.JPG','image'], ['song.mp3','audio'], ['movie.webm','video'], ['backup.gz','archive'], ['index.ts','code'],
    ['notes.pdf','file'], ['js','file'], ['.js','file'], ['file.constructor','file'], ['file.__proto__','file'], ['file.','file']])('infers the safe extension for %s', (name, type) => {
    expect(render({ name })).toContain(`data-file-type="${type}"`);
});
it('preserves explicit icon choices and omits empty optional content', () => {
    const output = render({ name: 'photo.png', type: 'file', size: '', status: '', thumbnail: '' });
    expect(output).toContain('data-file-type="file"'); expect(output).not.toContain('<button'); expect(output).not.toContain('<img'); expect(output).not.toContain('cs-attachment__status');
});
it('uses explicit status styling independently of English or translated text', () => {
    const neutral = render({ name: 'file.pdf', status: 'Upload failed' });
    expect(neutral).toContain('Upload failed'); expect(neutral).not.toContain('text-success'); expect(neutral).not.toContain('text-destructive');
    const failure = render({ name: 'file.pdf', status: 'Upload failed', statusVariant: 'error' });
    expect(failure).toContain('text-destructive'); expect(failure).not.toContain('text-success');
    const success = render({ name: 'file.pdf', status: '完了', statusVariant: 'success' });
    expect(success).toContain('text-success'); expect(success).not.toContain('text-destructive');
    expect(success).not.toContain('aria-live'); expect(success).not.toContain('role="status"');
});
it('localizes removal while retaining escaped filename text', () => {
    const output = render({ name: '<file>.pdf', removeLabel: 'Datei entfernen', onRemove: () => {} });
    expect(output).toContain('aria-label="Datei entfernen"'); expect(output).toContain('&lt;file&gt;.pdf'); expect(output).not.toContain('<file>');
});
it.each([{ name: undefined }, { name: '' }, { name: ' ' }, { type: 'constructor' }, { statusVariant: 'upload' },
    { size: 42 }, { status: false }, { thumbnail: {} }, { removeLabel: '' }, { onRemove: true }])('rejects invalid Attachment options %j', patch => {
    expect(() => render({ name: 'file.pdf', ...patch } as any)).toThrow('Attachment');
});
it('rejects discarded positional content', () => {
    expect(() => renderToString(component(Attachment, { name: 'file.pdf' }, 'Lost content'))).toThrow('does not accept component children');
});
