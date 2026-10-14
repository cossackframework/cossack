import { Cossack, createInstance, type ServiceScope } from '@cossackframework/core';

export interface RenderOptions<T extends Cossack> extends Omit<NonNullable<Parameters<Cossack['bootstrap']>[0]>, 'container' | 'initialState'> {
    props?: Partial<T['props']>;
    state?: { public?: Partial<T>; [key: string]: unknown };
    serviceScope?: ServiceScope;
    ownsServiceScope?: boolean;
}

export interface RenderResult<T extends Cossack> {
    instance: T;
    container: HTMLElement;
    html: () => string;
    click: (selector: string) => Promise<void>;
    type: (selector: string, text: string) => Promise<void>;
    waitForUpdate: () => Promise<void>;
    unmount: () => Promise<void>;
}

export async function render<T extends Cossack>(
    Component: new (...args: any[]) => T,
    options: RenderOptions<T> = {}
): Promise<RenderResult<T>> {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let instance: T | undefined;
    const { props, state, serviceScope, ownsServiceScope, ...facilities } = options;
    try {
        instance = createInstance(Component, { serviceScope, ownsServiceScope });
        await instance.bootstrap({ ...facilities, container, initialState: state ?? {} });
        if (props) {
            Object.assign(instance.props, props);
            await instance.requestUpdate();
        }
        await instance.updateComplete;
    } catch (error) {
        try {
            if (instance) await instance.destroyAsync();
            else if (ownsServiceScope) await serviceScope?.disposeAsync();
        }
        catch { /* Preserve the primary construction/bootstrap error. */ }
        finally { container.remove(); }
        throw error;
    }
    const mounted = instance;

    let unmounting: Promise<void> | undefined;

    const result: RenderResult<T> = {
        instance: mounted,
        container,
        html: () => container.innerHTML,
        waitForUpdate: async () => { await mounted.updateComplete; },
        click: async (selector: string) => {
            const el = container.querySelector(selector);
            if (!el) throw new Error(`Element not found: ${selector}`);
            if (el instanceof HTMLElement) {
                // Activate like a user: a disabled form control (including one
                // inside a disabled fieldset) ignores the click. The explicit
                // `:disabled` check keeps this true on DOM implementations whose
                // `click()` does not apply that rule.
                if (!el.matches(':disabled')) el.click();
            } else {
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }
            await mounted.updateComplete;
        },
        type: async (selector: string, text: string) => {
            const el = container.querySelector(selector);
            if (!el) throw new Error(`Element not found: ${selector}`);
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                el.value = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                await mounted.updateComplete;
            } else {
                throw new Error(`Element is not an input or textarea: ${selector}`);
            }
        },
        unmount: () => unmounting ??= (async () => {
            try { await mounted.destroyAsync(); }
            finally { container.remove(); }
        })()
    };

    return result;
}
