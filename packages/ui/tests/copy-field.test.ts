import { expect, it, vi } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { CopyField, SecretNotice } from '../src/components/CopyField';

it('renders a read-only, named field with a Copy button', () => {
    const output = renderToString(component(CopyField, { id: 'key', class: 'mt-2', label: 'New API key', value: 'sk_live_1' }));
    expect(output).toMatch(/<input[^>]*readonly/);
    expect(output).toContain('aria-label="New API key"');
    expect(output).toContain('value="sk_live_1"');
    expect(output).toContain('font-mono');
    expect(output).toContain('id="key"');
    expect(output).toMatch(/class="[^"]*cs-copy-field[^"]*mt-2|class="[^"]*mt-2[^"]*cs-copy-field/);
    expect(output).toMatch(/>\s*Copy\s*</);
    expect(output).toMatch(/<p role="status"[^>]*><\/p>/);
});

it('shows a multi-line value in a text area, with plain text when asked', () => {
    const output = renderToString(component(CopyField, { label: 'Recovery codes', value: 'a1\nb2\nc3', mono: false }));
    expect(output).toMatch(/<textarea[^>]*rows="3"/);
    expect(output).not.toContain('font-mono');
});

it('requires a label and a string value', () => {
    expect(() => renderToString(component(CopyField, { label: '', value: 'x' }))).toThrow('CopyField requires a label');
    expect(() => renderToString(component(CopyField, { label: 'Key', value: 1 } as never))).toThrow('CopyField requires a string value');
});

it('wraps the field in a notice that the value is shown once', () => {
    const output = renderToString(component(SecretNotice, { id: 'secret', label: 'New API key', value: 'sk_live_1', copyLabel: 'Kopieren' }));
    expect(output).toContain('Copy it now. You will not see it again.');
    expect(output).toContain('id="secret"');
    expect(output).toContain('role="group"');
    expect(output).toMatch(/>\s*Kopieren\s*</);
    expect(renderToString(component(SecretNotice, { label: 'Code', value: 'x', message: 'Save this code.' }))).toContain('Save this code.');
});


it('gives a secret notice a title, a note under the field and a Done button', async () => {
    const onDone = vi.fn();
    const notice = new SecretNotice();
    notice.props = { label: 'Invitation link', value: 'https://example.com/i/1', title: 'Invitation for ada@example.com', note: 'The link expires in seven days.', onDone, doneLabel: 'Fertig' };
    const output = renderToString(notice.render());
    expect(output).toContain('Invitation for ada@example.com');
    expect(output.indexOf('Invitation for ada@example.com')).toBeLessThan(output.indexOf('Copy it now.'));
    expect(output.indexOf('The link expires in seven days.')).toBeGreaterThan(output.indexOf('https://example.com/i/1'));
    expect(output).toMatch(/>\s*Fertig\s*</);
    const plain = renderToString(component(SecretNotice, { label: 'Code', value: 'x' }));
    expect(plain).not.toContain('cs-secret-notice__title');
    expect(plain).not.toContain('cs-secret-notice__note');
    expect(plain).not.toMatch(/>\s*Done\s*</);
});
