import { expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { SegmentBar, type SegmentBarProps } from '../src/components/SegmentBar';
function output(props: Partial<SegmentBarProps> = {}) {
    const bar = new SegmentBar();
    bar.props = { label: 'Files by kind', items: [{ id: 'image', label: 'Images', value: 3, valueText: '3 MB' }, { id: 'video', label: 'Video', value: 1 }, { id: 'audio', label: 'Audio', value: 0 }], ...props } as SegmentBarProps;
    return renderToString(bar.render());
}
it('draws a segment per nonzero part and names the whole with each share', () => {
    const out = output();
    expect(out.match(/<div class="h-full bg-chart-\d"[^>]*data-segment/g)).toHaveLength(2);
    expect(out).toContain('width:75%');
    expect(out).toContain('aria-label="Files by kind: Images: 3 MB (75%), Video: 1 (25%), Audio: 0 (0%)"');
    expect(out).toContain('3 MB · 75%');
    expect(output({ legend: false })).not.toContain('cs-segment-bar__legend');
    expect(output({ items: [] })).toContain('aria-label="Files by kind: 0"');
});
it.each([
    { label: '' }, { items: [{ id: 'a', label: 'A', value: -1 }] }, { items: [{ id: 'a', label: 'A', value: Number.NaN }] },
    { items: [{ id: 'a', label: 'A', value: 1 }, { id: 'a', label: 'B', value: 1 }] }, { items: [{ id: 'a', label: ' ', value: 1 }] },
])('refuses invalid props (%#)', props => {
    expect(() => output(props as Partial<SegmentBarProps>)).toThrow();
});
