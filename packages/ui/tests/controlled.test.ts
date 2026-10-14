import { expect, it } from 'vitest';
import { ControlledValue } from '../src/internal/controlled';

it('returns the current value when nothing was emitted', () => {
    const value = new ControlledValue<string>();
    const props = { value: 'a' };
    expect(value.base(props, props.value)).toBe('a');
    expect(value.pending(props)).toBe(false);
});

it('builds on the emitted value until props identity changes', () => {
    const value = new ControlledValue<readonly string[]>();
    const props = { value: [] as string[] };
    expect(value.emit(props, ['a'])).toEqual(['a']);
    expect(value.pending(props)).toBe(true);
    expect(value.base(props, props.value)).toEqual(['a']);
    value.emit(props, [...value.base(props, props.value), 'b']);
    expect(value.base(props, props.value)).toEqual(['a', 'b']);
});

it('lets the parent value win once the parent re-renders, even with equal content', () => {
    const value = new ControlledValue<boolean>();
    const props = { pressed: false };
    value.emit(props, true);
    // The parent rejects the edit: same value, new props object.
    const next = { pressed: false };
    expect(value.pending(next)).toBe(false);
    expect(value.base(next, next.pressed)).toBe(false);
});

it('treats a value as changed unless it matches both the rendered and the pending value', () => {
    const value = new ControlledValue<string>();
    const props = { value: 'a' };
    expect(value.changed(props, 'a', 'a')).toBe(false);
    expect(value.changed(props, 'a', 'b')).toBe(true);
    value.emit(props, 'b');
    // Back to the rendered value while 'b' is pending.
    expect(value.changed(props, 'a', 'a')).toBe(true);
    // The pending value again: re-emit so an ignoring parent can accept it.
    expect(value.changed(props, 'a', 'b')).toBe(true);
    expect(value.changed({ value: 'a' }, 'a', 'a')).toBe(false);
});

it('forgets the pending value on reset', () => {
    const value = new ControlledValue<string>();
    const props = { value: '' };
    value.emit(props, 'x');
    value.reset();
    expect(value.base(props, props.value)).toBe('');
    expect(value.pending(props)).toBe(false);
});
