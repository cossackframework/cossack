// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { ToggleGroup, type ToggleGroupProps } from '../src/components/ToggleGroup';

const items = [{ value: 'a' }, { value: 'b' }, { value: 'c' }];

function group(props: Omit<ToggleGroupProps, 'label'>) {
    const control = new ToggleGroup();
    control.props = { label: 'Format', items, ...props } as ToggleGroupProps;
    return control;
}

it('accumulates multiple toggles made before the controlled parent re-renders', () => {
    const onChange = vi.fn();
    const control = group({ type: 'multiple', value: [], onChange });
    control.toggle('a');
    control.toggle('b');
    expect(onChange.mock.calls).toEqual([[['a']], [['a', 'b']]]);
});

it('untoggles a pending multiple pick instead of re-adding it', () => {
    const onChange = vi.fn();
    const control = group({ type: 'multiple', value: ['c'], onChange });
    control.toggle('a');
    control.toggle('a');
    expect(onChange.mock.calls).toEqual([[['c', 'a']], [['c']]]);
});

it('toggles a pending single value off instead of emitting it twice', () => {
    const onChange = vi.fn();
    const control = group({ type: 'single', value: '', onChange });
    control.toggle('a');
    control.toggle('a');
    expect(onChange.mock.calls).toEqual([['a'], ['']]);
});

it('builds on the parent value again once the parent re-renders', () => {
    const onChange = vi.fn();
    const control = group({ type: 'multiple', value: ['c'], onChange });
    control.toggle('a');
    // The parent rejects the edit and re-renders with its own value.
    control.props = { ...control.props };
    control.toggle('b');
    expect(onChange.mock.lastCall).toEqual([['c', 'b']]);
});
