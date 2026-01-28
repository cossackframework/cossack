import { Cossack } from '@cossackframework/core';

export interface RenderResult<T extends Cossack> {
    instance: T;
    container: HTMLElement;
    html: () => string;
    click: (selector: string) => Promise<void>;
    type: (selector: string, text: string) => Promise<void>;
    waitForUpdate: () => Promise<void>;
    unmount: () => void;
}

export async function render<T extends Cossack>(
    Component: new () => T,
    options: { props?: any, state?: any } = {}
): Promise<RenderResult<T>> {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const instance = new Component();
    
    await instance.bootstrap({
        container,
        initialState: options.state || {},
    });

    if (options.props) {
        Object.assign(instance.props, options.props);
        instance.requestUpdate();
    }

    await instance.updateComplete;

    const result: RenderResult<T> = {
        instance,
        container,
        html: () => container.innerHTML,
        waitForUpdate: async () => { await instance.updateComplete; },
        click: async (selector: string) => {
            const el = container.querySelector(selector);
            if (!el) throw new Error(`Element not found: ${selector}`);
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await instance.updateComplete;
        },
        type: async (selector: string, text: string) => {
            const el = container.querySelector(selector);
            if (!el) throw new Error(`Element not found: ${selector}`);
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                el.value = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                await instance.updateComplete;
            }
        },
        unmount: () => {
            instance.destroy();
            document.body.removeChild(container);
        }
    };

    return result;
}
