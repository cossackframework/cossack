import { Cossack, server$, type ServerResourceStatus } from '@cossackframework/core';

interface User { id: number; name: string }
class Resources extends Cossack<{}, { Resources: 'users' | 'selected' | 'missing' | 'count' | 'empty' | 'optional' }> {
    users = server$(async (): Promise<User[]> => [], { initial: [] });
    selected = server$((): User | null => null, { initial: null });
    count = server$(() => 1, { initial: 0 });
    empty = server$(() => null, { initial: null });
    optional = server$((): User | undefined => undefined, { initial: undefined });
    query = '';

    check() {
        const status = this.resourceStatus$('users');
        const typed: ServerResourceStatus<User[]> = status;
        if (status.state === 'ready') {
            const users: User[] = status.value;
            status.value[0]?.name.toUpperCase();
            // @ts-expect-error Resource values retain the loader's field type.
            const numbers: number[] = status.value;
            void users; void numbers;
        }
        if (status.state === 'pending' && !status.hasValue) {
            const unavailable: undefined = status.value;
            void unavailable;
        }
        const selected = this.resourceStatus$('selected');
        if (selected.state === 'ready') {
            const user: User | null = selected.value;
            // @ts-expect-error Ready does not erase a nullable loader result.
            const required: User = selected.value;
            void user; void required;
        }
        const count = this.resourceStatus$('count');
        if (count.hasValue) {
            count.value.toFixed();
            // @ts-expect-error Number resources are not strings.
            count.value.toUpperCase();
        }
        const empty = this.resourceStatus$('empty');
        if (empty.state === 'ready') { const value: null = empty.value; void value; }
        const optional = this.resourceStatus$('optional');
        if (optional.state === 'ready') { const value: User | undefined = optional.value; void value; }
        void this.refresh$('users');
        this.invalidate$('selected');
        // @ts-expect-error Existing state is not a declared resource target.
        void this.refresh$('query');
        // @ts-expect-error Misspelled targets fail before runtime.
        this.invalidate$('usres');
        // @ts-expect-error A declared name must also exist on the component.
        this.resourceStatus$('missing');
        // @ts-expect-error Resource names cannot be arbitrary dynamic strings.
        this.resourceStatus$('users' as string);
        void typed;
    }
}

class Derived extends Resources {
    checkInherited() {
        const status = this.resourceStatus$('users');
        if (status.state === 'ready') { const user: User = status.value[0]!; void user; }
        // @ts-expect-error Inherited declarations remain restricted.
        void this.refresh$('check');
    }
}
void Resources; void Derived;

class RuntimeChecked extends Cossack {
    checkInline() {
        const status = this.resourceStatus$('render:0');
        if (status.state === 'ready') {
            const value: unknown = status.value;
            // @ts-expect-error Undeclared resource values retain the runtime-only unknown contract.
            const number: number = status.value;
            void value; void number;
        }
    }
}
void RuntimeChecked;
