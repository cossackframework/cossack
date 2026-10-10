import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { Alert } from '../src/components/Alert';
import { Progress } from '../src/components/Progress';
import { Spinner } from '../src/components/Spinner';

it('separates alert tone from announcement urgency without adding focus behavior', () => {
    for (const [announcement, role] of [['assertive', 'alert'], ['polite', 'status'], ['off', undefined]] as const) {
        const output = renderToString(component(Alert, { announcement, variant: 'success', title: 'Saved', id: 'notice' }, 'Changes saved'));
        if (role) expect(output).toContain(`role="${role}"`);
        else expect(output).not.toContain('role=');
        expect(output).toContain('aria-hidden="true"');
        expect(output).toContain('Changes saved');
        expect(output).not.toMatch(/\s(?:announcement|variant|tabindex|title)=/);
    }
    expect(renderToString(component(Alert, { icon: null }, 'Text'))).not.toContain('<svg');
});
it.each([{variant:'__proto__'}, {announcement:'urgent'}])('rejects invalid alert options', props => {
    expect(() => renderToString(component(Alert, props as any))).toThrow('Alert');
});
it('keeps unknown progress distinct from zero and clamps finite progress', () => {
    for (const value of [undefined, null]) {
        const output = renderToString(component(Progress, { label: 'Upload', value }));
        expect(output).not.toContain('aria-valuenow');
        expect(output).toContain('data-state="indeterminate"');
        expect(output).toContain('aria-label="Upload"');
    }
    for (const [value, expected] of [[-5, 0], [0, 0], [20, 20], [120, 80]]) {
        const output = renderToString(component(Progress, { label: 'Upload', value, max: 80, valueText: 'Uploading files' }));
        expect(output).toContain(`aria-valuenow="${expected}"`);
        expect(output).toContain(`width:${expected / 80 * 100}%`);
        expect(output).toContain('aria-valuetext="Uploading files"');
        expect(output).toContain('data-state="determinate"');
        expect(output).not.toMatch(/\s(?:value|valueText|label|max|size|tabindex)=/);
    }
});
it.each([{label:''}, {label:' '}, {value:NaN}, {value:Infinity}, {max:0}, {max:-1}, {max:Infinity}, {size:'huge'}, {valueText:''}])('rejects invalid progress contracts', props => {
    expect(() => renderToString(component(Progress, {label:'Upload', ...props} as any))).toThrow('Progress');
});
it('renders labelled SVG status text or a decorative spinner without a focus stop', () => {
    const output = renderToString(component(Spinner, {label:'Loading <files>', size:24, stroke:3, id:'spinner'}));
    expect(output).toContain('<title>Loading &lt;files&gt;</title>');
    expect(output).toContain('role="status"');
    expect(output).toContain('r="10.5"');
    expect(output).toContain('focusable="false"');
    expect(output).toContain('motion-reduce:animate-none');
    expect(output.slice(0, output.indexOf('>'))).not.toMatch(/\s(?:label|size|stroke)=/);
});
it.each([{size:0}, {size:Infinity}, {size:Number.MAX_VALUE}, {stroke:0}, {stroke:20}, {stroke:-1}, {label:''}, {label:' '}])('rejects invalid spinner geometry or names', props => {
    expect(() => renderToString(component(Spinner, props))).toThrow('Spinner');
});
