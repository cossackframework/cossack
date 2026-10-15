/**
 * Edit base for a controlled component.
 *
 * A controlled component renders from `props.value`, but a parent applies a
 * proposed value (`onValueChange`, `onOpenChange`, ...) in a later render.
 * Until then, `props.value` is stale. If a second edit arrives in that window
 * and builds on the stale prop, it discards the first edit (two rapid toggles
 * emit `['a']` then `['b']`) or re-emits a value that is already pending (a
 * double click emits `true` twice).
 *
 * Protocol: remember the last emitted value together with the `props` object
 * it was emitted under. While `props` keeps that identity, the next edit
 * builds on the emitted value. When the parent renders, it assigns a new
 * `props` object, and the rendered value wins again. A parent can therefore
 * still reject an edit by re-rendering with its own value.
 */
export class ControlledValue<T> {
    private emitted?: { props: object; value: T };

    /** The value the next edit builds on: the pending emitted value, or `current`. */
    base(props: object, current: T): T {
        return this.emitted?.props === props ? this.emitted.value : current;
    }

    /** True while a value emitted under these props has not been re-rendered by the parent. */
    pending(props: object): boolean {
        return this.emitted?.props === props;
    }

    /**
     * Whether setting `value` is a change worth emitting: it differs from the
     * rendered value or from the pending one. Re-picking a pending value is
     * emitted again, so a parent that ignored it can still accept it.
     */
    changed(props: object, current: T, value: T): boolean {
        return !Object.is(value, current) || !Object.is(value, this.base(props, current));
    }

    /** Records `value` as emitted under `props` and returns it. */
    emit<V extends T>(props: object, value: V): V {
        this.emitted = { props, value };
        return value;
    }

    /** Forgets the pending value, for example after a form reset. */
    reset(): void {
        this.emitted = undefined;
    }
}
